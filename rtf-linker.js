'use strict';

const AWS = require('aws-sdk');
const cs = new AWS.CloudSearchDomain({endpoint: 'doc-pasicrisie-4wqicx6rj444xcjcbos3hamuyy.eu-central-1.cloudsearch.amazonaws.com'});
const s3 = new AWS.S3();
const fs = require('fs');
const rtf2text = require('rtf2text');
const convertapi = require('convertapi')('cW6UKhaYOtrPEhZT');

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
        matcher = /{[^{]*\\tab[^}]*}/g;
        let skipIndex = rtf.indexOf('Division:');
        skipIndex = skipIndex === -1? 0 : skipIndex + 1;
        const usableRtf = rtf.substr(skipIndex);
        let valueUsableRtf = usableRtf, shift = 0;
        bookmarks.forEach((bookmark, i) => {
            if(i === 0) return; //No link to level title
            matched = matcher.exec(usableRtf);
            if(matched === null) return; //Should not happen but eh...
            let beginIndex = matched.index, endIndex = matched.index + matched[0].length + 1, countLeft = 1, lastDeacreaseBracket = false;
            while(countLeft > 0 || !lastDeacreaseBracket) {
                endIndex++;
                if(usableRtf[endIndex] === ')' && usableRtf[endIndex + 1] === '}') {
                    lastDeacreaseBracket = true;
                    countLeft--;
                } else if(usableRtf[endIndex - 1] !== ')' && usableRtf[endIndex] === '}') {
                    lastDeacreaseBracket = false;
                    countLeft--;
                } else if(usableRtf[endIndex] === '{') {
                    countLeft++;
                }
            }
            endIndex += 2;
            console.log('------> FROM: ' + matched[0] + '\n------> TO:' + usableRtf.substring(beginIndex, endIndex) + '\n');
            valueUsableRtf = valueUsableRtf.substr(0, shift + beginIndex) + '{\\field{\\*\\fldinst HYPERLINK \\\\l "' + bookmark
                + '"}{\\fldrslt{\\ul\\cf2 ' + usableRtf.substring(beginIndex, endIndex) + '}}}'
                + valueUsableRtf.substr(shift + endIndex);
            shift = valueUsableRtf.length - usableRtf.length;
        });
        rtf = rtf.substr(0, skipIndex) + valueUsableRtf;

        //Return new text
        callback(undefined, fulltext, rtf);
    });
}

function convertToPdf(rtf, callback) {
    const tempName = '/tmp/' + Math.random() + '.rtf';
    fs.writeFile(tempName, rtf, err => {
        if(err) {
            console.log('Cannot write temp file');
            callback(err);
            return;
        }
        convertapi.convert('pdf', {File: tempName}).then(result => {
            result.file.save(tempName).then(() => {
                fs.readFile(tempName, (err, data) => {
                    if(err) {
                        console.log('Cannot read temp file');
                        callback(err);
                        return;
                    }
                    callback(undefined, data);
                });
            }, callback);
        }, callback);
    });
}

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
                cs.uploadDocuments({
                    contentType: 'application/json',
                    documents: JSON.stringify([{
                        type: 'add',
                        id: keyParts[keyParts.length - 1].split('.')[0],
                        fields: {
                            id: keyParts[keyParts.length - 1].split('.')[0],
                            kind: keyParts[0],
                            author: 'Pasicrisie',
                            issue: '1970-01-01T00:00:00Z',
                            fulltext: fulltext
                        }
                    }])
                }, err => {
                    if (err) {
                        callback(err);
                        return;
                    }
                    convertToPdf(rtf, (err, pdfBuffer) => {
                        if(err) {
                            callback(err);
                            return;
                        }
                        s3.putObject({
                            Body: pdfBuffer,
                            Bucket: bucket.replace('raw-rtf', 'pdf'),
                            Key: key.replace('rtf', 'pdf')
                        }, callback);
                    });
                });
            });
        });
    });
};

// This is a main call
if(process.argv[2]) {
    console.log('Parsing ' + process.argv[2]);
    const body = fs.readFileSync(process.argv[2]).toString();
    parseBack(body, 'pasicrisie-pdf', 'bulletin/test.rtf', (_, __, rtf) => {
        fs.writeFileSync(process.argv[2].replace(/.rtf$/, '-linked.rtf'), rtf);
        convertToPdf(rtf, (_, pdfBuffer) => fs.writeFileSync(process.argv[2].replace(/.rtf$/, '-linked.pdf'), pdfBuffer));
    });
}
