'use strict';

const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const foldersToTreatMatcher = /\/blue\//;
const baseS3Url = 'https://s3.eu-west-2.amazonaws.com/';

exports.handler = (event, context, callback) => {
    const bucket = event.Records[0].s3.bucket.name, key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    const keyParts = key.split('/');
    if(!foldersToTreatMatcher.test(key))
        return;
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
        // TODO: add links and find some keywords and name of book and author
        rtf = rtf.replace(/[0-9]{5}/g, t => '{\\colortbl ;\\red0\\green0\\blue238;}\n'
            + '{\\field{\\*\\fldinst HYPERLINK "' + baseS3Url + bucket
            + '/' + key.replace(/[0-9]{5}/, t) + '"}{\\fldrslt{\\ul\\cf1 ' + t + '}}}');
        s3.putObject({
            Body: rtf,
            Bucket: bucket.replace('raw', 'linked'),
            Key: key
        }, err => {
            if(err) {
                callback(err);
                return;
            }
            dynamo.put({
                TableName: 'pasicrisie_documents',
                Item: {
                    _id: keyParts[keyParts.length - 1].replace(/\.[^.]+$/, ''),
                    type: keyParts[0],
                    author: '',
                    name: '',
                    keywords: [],
                    date: '1970-01-01',
                    searchable: false
                }
            }, callback);
        });
    });
};
