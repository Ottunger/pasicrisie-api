'use strict';

const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();
const fs = require('fs');
const stream = require('stream');
const rtf2text = require('rtf2text');
const cloudconvert = new (require('cloudconvert'))('JGg1oJt2CqnFjx19Ui6LAj3ue56Ax9rpRz37Mlgjv0ajSRYCIkw7LxPf5AA1UyiD');

const foldersNonFullText = /non-full-text\//; //all are full text for now
const baseS3Url = 'https://bulletin.pasicrisie.lu/';
const possibleKeywords = ['actes administratifs', 'actes reglementaires', 'agriculture', 'armes prohibees', 'autorisation d\'etablissement',
    'communes', 'competence', 'droits de l\'homme et libertes fondamentales', 'elections', 'enseignement', 'entraide judiciaire',
    'environnement', 'etrangers', 'experts', 'expropriation pour cause d\'utilite publique', 'finances publiques', 'fonction publique',
    'impots', 'langues', 'logement', 'lois et reglements', 'marches publics', 'noms – prenoms – domicile – etat civil – nationalite',
    'postes et telecommunications', 'pratiques commerciales', 'procedure administrative non contentieuse',
    'procedure contentieuse', 'protection des donnees', 'recours en annulation', 'recours en reformation', 'regulation economique',
    'sante publique', 'securite sociale', 'sites et monuments', 'transports', 'travail', 'tutelle administrative',
    'urbanisme', 'voirie'];

function parseBack(rtf, bucket, key, callback) {
    rtf2text.string(rtf, (err, fulltext) => {
        if(err) {
            callback(err);
            return;
        }
        //Check external links to judgements
        let matcher = /[^a-z0-9](([0-9]{5}|(9[0-9]{3}))[a-z]?(-[0-9])?)[^\\/0-9a-z]/gi, done = {}, matched;
        while((matched = matcher.exec(fulltext)) !== null) {
            if(!done[matched[1]]) {
                done[matched[1]] = true;
                rtf = rtf.replace(new RegExp('[^a-z0-9]' + matched[1] + '[^\\/0-9a-z]', 'gi'), t => {
                    const firstLetter = t.substring(0, 1), body = t.substring(1, t.length - 1), lastLetter = t.substring(t.length - 1);
                    return firstLetter + '{\\field{\\*\\fldinst HYPERLINK "' + baseS3Url + '?type='
                        + key.replace(/\/[^/]+$/, '-' + body) + '"}{\\fldrslt{\\ul\\cf2 ' + body + '}}}' + lastLetter;
                });
            }
        }

        //Check external links to bulletin
        possibleKeywords.forEach(keyword => {
            rtf = rtf.replace(new RegExp('v\\. ' + keyword.replace(/[aeiou]/g, '([A-zÀ-ÿ]|(\\\\[^ ]+ [aeiou]?))'), 'gi'),
                    occurence => '{\\field{\\*\\fldinst HYPERLINK "' + baseS3Url + '?type=bulletin-'
                        + keyword.replace(/'/g, '').replace(/ /g, '_') + '"}{\\fldrslt{\\ul\\cf2 ' + occurence + '}}}');
        });

        //Check internal links, we put them on elements giving page count
        matcher = /({\\\*\\bkmkstart (_?Toc[0-9]+)}\s*)+/g;
        const bookmarks = [];
        while((matched = matcher.exec(rtf)) !== null) {
            bookmarks.push(matched[2]);
        }
        //console.log(bookmarks, bookmarks.length);
        matcher = /{[^{:*]*\([^\\][^):*]*[^a-z0-9][0-9][^):*]*\)[^}:*]*}/g;
        let skipIndex = rtf.indexOf('Division:');
        skipIndex = skipIndex === -1? 0 : skipIndex;
        let usableRtf = rtf.substr(skipIndex);
        bookmarks.forEach((bookmark, i) => {
            if(i === 0) return; //No link to level title
            matched = matcher.exec(usableRtf);
            if(matched === null) return; //Should not happen but eh...
            //console.log('\n' + matched[0] + '\n');
            usableRtf = usableRtf.substr(0, matched.index) + '{\\field{\\*\\fldinst HYPERLINK \\\\l "' + bookmark
                + '"}{\\fldrslt{\\ul\\cf2 ' + matched[0] + '}}}' + usableRtf.substr(matched.index + matched[0].length);
        });
        rtf = rtf.substr(0, skipIndex) + usableRtf;

        //Return new text
        callback(undefined, fulltext, rtf);
    });
}
exports.parseOut = fileName => {
    const body = fs.readFileSync(fileName).toString();
    parseBack(body, 'pasicrisie-pdf', 'bulletin/test.rtf', (_, __, rtf) => {
        fs.writeFileSync(fileName.replace(/.rtf$/, '-linked.rtf'), rtf);
    });
};

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
        parseBack(rtf, bucket, key, (err, fulltext, rtf) => {
            if(err) {
                callback(err);
                return;
            }
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
                            Key: key.replace('rtf', 'pdf')
                        }, err => {
                            if (err) {
                                callback(err);
                                return;
                            }
                            const lowFulltext = fulltext.toLowerCase();
                            dynamo.put({
                                TableName: 'pasicrisie_documents',
                                Item: {
                                    _id: keyParts[keyParts.length - 1].split('.')[0],
                                    kind: keyParts[0],
                                    author: 'Pasicrisie',
                                    desc: fulltext.substr(0, 1024),
                                    keywords: possibleKeywords.filter(k => lowFulltext.indexOf(k) > -1),
                                    issue: '1970-01-01',
                                    fulltext: foldersNonFullText.test(key)? undefined : fulltext.replace(/(\b(\w{1,4})\b(\W|$))/g, '').replace(/\s{2,}/g, ' '),
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
