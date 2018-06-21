'use strict';

const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();
const stream = require('stream');
const rtf2text = require('rtf2text');
const cloudconvert = new (require('cloudconvert'))('JGg1oJt2CqnFjx19Ui6LAj3ue56Ax9rpRz37Mlgjv0ajSRYCIkw7LxPf5AA1UyiD');

const foldersNonFullText = /bulletin\//;
const baseS3Url = 'https://s3.eu-central-1.amazonaws.com/';
const possibleKeywords = ['actes administratifs', 'actes reglementaires', 'agriculture', 'armes prohibees', 'autorisation d\'etablissement',
    'communes', 'competence', 'droits de l\'homme et libertes fondamentales', 'elections', 'enseignement', 'entraide judiciaire',
    'environnement', 'etrangers', 'experts', 'expropriation pour cause d\'utilite publique', 'finances publiques', 'fonction publique',
    'impôts', 'langues', 'logement', 'lois et reglements', 'marches publics', 'noms – prenoms – domicile – etat civil – nationalite',
    'postes et telecommunications', 'pratiques commerciales', 'procedure administrative non contentieuse',
    'procedure contentieuse', 'protection des donnees', 'recours en annulation', 'recours en reformation', 'régulation économique',
    'sante publique', 'securite sociale', 'sites et monuments', 'transports', 'travail', 'tutelle administrative',
    'urbanisme', 'voirie'];

exports.handler = (event, context, callback) => {
    const bucket = event.Records[0].s3.bucket.name, key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    const keyParts = key.split('/');
    //Get object and process RTF to add links
    s3.getObject({
        Bucket: bucket,
        Key: key
    }, (err, data) => {
        if(err) {
            callback(err);
            return;
        }
        let rtf = data.Body.toString();
        rtf2text.string(rtf, (err, fulltext) => {
            if(err) {
                callback(err);
                return;
            }
            //Change RTF: use only the links in the body
            const matcher = /[^a-z0-9]([0-9]{5}[a-z]?(-[0-9])?)[^\\/0-9a-z]/gi, done = {};
            let matched;
            while((matched = matcher.exec(fulltext)) !== null) {
                if(!done[matched[1]]) {
                    done[matched[1]] = true;
                    rtf = rtf.replace(new RegExp('[^a-z0-9]' + matched[1] + '[^\\/0-9a-z]', 'gi'), t => {
                        const firstLetter = t.substring(0, 1), body = t.substring(1, t.length - 1), lastLetter = t.substring(t.length - 1);
                        return firstLetter + '{\\field{\\*\\fldinst HYPERLINK "' + baseS3Url + bucket.replace('raw-rtf', 'pdf') + '/'
                            + key.replace(/\/[^/]+$/, '/' + body + '.pdf') + '"}{\\fldrslt{\\ul\\cf5 ' + body + '}}}' + lastLetter;
                    });
                }
            }
            const lowFulltext = fulltext.toLowerCase();
            s3.putObject({
                Body: rtf,
                Bucket: bucket.replace('raw', 'linked'),
                Key: key
            }, err => {
                if(err) {
                    callback(err);
                    return;
                }
                let pdf = [];
                const rtfStream = new stream.PassThrough();
                const pdfStream = new stream.Writable();
                pdfStream._write = (chunk, encoding, done) => {
                    pdf.push(chunk);
                    if(chunk.toString().indexOf('DocChecksum') > -1) {
                        s3.putObject({
                            Body: Buffer.concat(pdf),
                            Bucket: bucket.replace('raw-rtf', 'pdf'),
                            Key: key.replace('rtf', 'pdf'),
                            ACL: 'public-read'
                        }, err => {
                            if (err) {
                                callback(err);
                                return;
                            }
                            dynamo.put({
                                TableName: 'pasicrisie_documents',
                                Item: {
                                    _id: keyParts[keyParts.length - 1].split('.')[0],
                                    kind: keyParts[0],
                                    author: 'Pasicrisie',
                                    desc: fulltext.substr(0, 1024),
                                    keywords: possibleKeywords.filter(k => lowFulltext.indexOf(k) > -1),
                                    issue: '1970-01-01',
                                    fulltext: foldersNonFullText.test(key)? undefined : fulltext,
                                    searchable: true
                                }
                            }, callback);
                        });
                    }
                    done();
                };
                pdfStream.on('error', callback);
                rtfStream.write(rtf);
                rtfStream.end();
                rtfStream.pipe(cloudconvert.convert({
                    inputformat: 'rtf',
                    outputformat: 'pdf'
                })).pipe(pdfStream);
            });
        });
    });
};
