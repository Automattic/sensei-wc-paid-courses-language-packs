/* jshint node:true */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const download = require('download');
const po = require('pofile');
const { exec } = require('child_process');

module.exports = function (grunt) {
    'use strict';

    const translationMeta = {};

    grunt.initConfig({
        prefix: 'sensei-wc-paid-courses',
        minimumPercentageComplete: 30,
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
        const done = this.async();
        if ( ! version ) {
            grunt.log.error('Must be called with version number. Example: `grunt build:1.0.0`');
            done();
            return;
        }
        const basePackagePath = 'packages/' + version;
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

                    return;
                }

                const languageBuilds = [];
                translations.translation_sets.forEach(function (ts) {
                    if (ts.percent_translated < grunt.config.get('minimumPercentageComplete')) {
                        grunt.log.writeln("Skipping " + ts.name + " as it is only " + ts.percent_translated + "% translated.");

                        return true;
                    }
                    languageBuilds.push(buildLanguage(basePackagePath, ts));
                });

                const buildPromise = Promise.all(languageBuilds);
                buildPromise.then(res => {
                    const metaPath = basePackagePath + '/index.json';
                    const metadata = {};
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
            const tmpLangPath = 'tmp/' + ts.wp_locale;
            const tmpMoPath = tmpLangPath + '/' + grunt.config.get('prefix') + '-' + ts.wp_locale + '.mo';
            const tmpPoPath = tmpLangPath + '/' + grunt.config.get('prefix') + '-' + ts.wp_locale + '.po';

            if ( fs.existsSync(tmpLangPath) ) {
                fs.readdir(tmpLangPath, (err, files) => {
                    if (err) throw err;

                    for (const file of files) {
                        fs.unlink(path.join(tmpLangPath, file), err => {
                            if (err) throw err;
                        });
                    }
                });
            } else {
                fs.mkdirSync( tmpLangPath, { recursive: true } );
            }

            const downloads = [];
            downloads.push(downloadFile(grunt.config.get('baseFileUrl') + '/' + ts.locale + '/default/export-translations/?format=po', tmpPoPath));
            downloads.push(downloadFile(grunt.config.get('baseFileUrl') + '/' + ts.locale + '/default/export-translations/?format=mo', tmpMoPath));
            const downloadPromises = Promise.all(downloads);

            downloadPromises.then(function () {
                if (!fs.existsSync(tmpPoPath) || !fs.existsSync(tmpMoPath)) {
                    reject();
                    throw Error("Unable to download files for " + ts.name);
                }
            })
                .catch(err => {
                    grunt.log.error(err);
                    grunt.log.error("Unable to download files for " + ts.name);
                })
                .then(function () {
                    grunt.log.writeln("Downloaded all files for " + ts.name);

                    const zipDest = basePackagePath + '/' + ts.wp_locale + '.zip';

                    exec(
                        'cd ' + tmpLangPath + ' && ../../vendor/bin/wp i18n make-json --no-purge ' + path.parse( tmpPoPath ).base,
                        function ( error, stdout, stderr ) {
                            if ( error ) {
                                reject();
                                return;
                            }

                            fs.readdir(tmpLangPath, (err, files) => {
                                if (err) throw err;

                                const zip = new require('node-zip')();
                                for (const file of files) {
                                    zip.file(file, fs.readFileSync(path.join(tmpLangPath, file)));
                                }

                                const data = zip.generate({
                                    base64: false,
                                    compression: 'DEFLATE'
                                });

                                fs.writeFileSync(zipDest, data, 'binary');

                                po.load(tmpPoPath, function (err, po) {
                                    const metadata = {};
                                    metadata['updated'] = false;
                                    if ( typeof po.headers['PO-Revision-Date'] === 'string' ) {
                                        metadata['updated'] = po.headers['PO-Revision-Date'];
                                    }
                                    translationMeta[ts.wp_locale] = metadata;
                                    resolve();
                                });
                            });


                        }
                    );
                })
                .catch(err => {
                    grunt.log.error(err);
                });
        }).catch(err => [Error]);
    });


};
