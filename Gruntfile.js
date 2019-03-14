/* jshint node:true */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const download = require('download');
const po = require('pofile');

module.exports = function (grunt) {
    'use strict';

    let translationMeta = {};

    grunt.initConfig({
        prefix: 'sensei-wc-paid-courses',
        minimumPercentageComplete: 70,
        baseFileUrl: 'https://translate.wordpress.com/projects/sensei%2Fsensei-wc-paid-courses',
        clean: {
            tmp: "tmp/*"
        }
    });

    grunt.loadNpmTasks('grunt-contrib-clean');

    grunt.registerTask( 'default', function () {
        grunt.log.writeln( "########################################################### " );
        grunt.log.writeln( "##### Sensei WC Paid Courses Language Pack Generator ###### " );
        grunt.log.writeln( "########################################################### " );
        grunt.log.writeln( " # Commands: \n" );
        grunt.log.writeln( " grunt build:{version}    =  Build all the translation packages." );
    });

    grunt.registerTask('build', function (version) {
        let done = this.async();
        if ( ! version ) {
            grunt.log.error('Must be called with version number. Example: `grunt build:1.0.0`');
            done();
            return;
        }
        let basePackagePath = 'packages/' + version;
        if ( fs.existsSync(basePackagePath) ) {
            grunt.log.writeln('Updating packages for version ' + version);
            fs.readdir(basePackagePath, (err, files) => {
                if (err) throw err;

                for (const file of files) {
                    fs.unlink(path.join(basePackagePath, file), err => {
                        if (err) throw err;
                    });
                }
            });
        } else {
            grunt.log.writeln('Creating packages for new version ' + version);
            fs.mkdirSync(basePackagePath);
        }

        grunt.log.write("Fetching languages...");

        fetch('https://translate.wordpress.com/api/projects/sensei/sensei-wc-paid-courses/')
            .then(function (response) {
                if (!response.ok) {
                    throw Error(response.statusText);
                }
                return response;
            })
            .then(res => res.json())
            .then(translations => {
                grunt.log.writeln("done!");

                if (typeof translations.translation_sets === 'array') {
                    grunt.log.error("Invalid set of translations received.");
                    done();
                }
                let languageBuilds = [];
                translations.translation_sets.forEach(function (ts) {
                    if (ts.percent_translated < grunt.config.get('minimumPercentageComplete')) {
                        grunt.log.writeln("Skipping " + ts.name + " as it is only " + ts.percent_translated + "% translated.");
                    }
                    languageBuilds.push(buildLanguage(basePackagePath, ts));
                });

                let buildPromise = Promise.all(languageBuilds);
                buildPromise.then(res => {
                    let metaPath = basePackagePath + '/index.json';
                    let metadata = {};
                    metadata['built']    = (new Date()).toISOString();
                    metadata['version']  = version;
                    metadata['packages'] = translationMeta;
                    fs.writeFileSync(metaPath, JSON.stringify(metadata));
                    grunt.log.writeln("Built all packages!");
                    grunt.task.run('clean:tmp');
                    done();
                });
            })
            .catch(error => {
                grunt.log.writeln("error! (" + error + ")");
            });
    });

    const downloadFile = (async (url, downloadPath) => {
        await download(url).then(data => {
            fs.writeFileSync(downloadPath, data);
        })
    });

    const buildLanguage = (async (basePackagePath, ts) => {
        await new Promise((resolve, reject) => {
            let tmpMoPath = 'tmp/' + grunt.config.get('prefix') + '-' + ts.wp_locale + '.mo';
            let tmpPoPath = 'tmp/' + grunt.config.get('prefix') + '-' + ts.wp_locale + '.po';
            let downloads = [];
            downloads.push(downloadFile(grunt.config.get('baseFileUrl') + '/' + ts.locale + '/default/export-translations/?format=po', tmpPoPath));
            downloads.push(downloadFile(grunt.config.get('baseFileUrl') + '/' + ts.locale + '/default/export-translations/?format=mo', tmpMoPath));
            let downloadPromises = Promise.all(downloads);

            downloadPromises.then(function () {
                if (!fs.existsSync(tmpMoPath) || !fs.existsSync(tmpMoPath)) {
                    reject();
                    throw Error("Unable to download files for " + ts.name);
                }
            })
            .catch(err => {
                grunt.log.error("Unable to download files for " + ts.name);
            })
            .then(function () {
                grunt.log.writeln("Downloaded all files for " + ts.name);

                let zipDest = basePackagePath + '/' + ts.wp_locale + '.zip';

                let zip = new require('node-zip')();
                zip.file(path.basename(tmpPoPath), fs.readFileSync(tmpPoPath));
                zip.file(path.basename(tmpMoPath), fs.readFileSync(tmpMoPath));

                var data = zip.generate({
                    base64: false,
                    compression: 'DEFLATE'
                });
                fs.writeFileSync(zipDest, data, 'binary');


                po.load(tmpPoPath, function (err, po) {
                    let metadata = {};
                    metadata['updated'] = false;
                    if ( typeof po.headers['PO-Revision-Date'] === 'string' ) {
                        metadata['updated'] = po.headers['PO-Revision-Date'];
                    }
                    grunt.log.writeln("Added meta for " + ts.wp_locale);
                    translationMeta[ts.wp_locale] = metadata;
                    resolve();
                });
            })
            .catch(err => {
                grunt.log.error(err);
            });
        }).catch(err => [Error]);
    });


};
