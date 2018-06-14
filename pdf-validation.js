'use strict';

const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient();

/**
 * Expected event format:
 * event {
 *    bucket (M): The name of the bucket
 *    pdfKey: The path to the PDF element in the bucket
 *    pageMarker: If no pdfKey is given, runs on a whole bucket. Specifies the page (1000 el/page)
 *    keywords: A list of keywords to add to the item
 *    date: The publication date in format YYYY-MM-DD
 * }
 */
exports.handler = (event, context, callback) => {
    if(event.pdfKey) {
        const keyParts = event.pdfKey.split('/');
        s3.headObject({
            Bucket: event.bucket,
            Key: event.pdfKey
        }, err => {
            if (err) {
                callback(err);
                return;
            }
            dynamo.update({
                TableName: 'pasicrisie_documents',
                Key: {_id: keyParts[keyParts.length - 1].replace(/\.[^.]+$/, '')},
                UpdateExpression: 'searchable = true'
                + (event.keywords ? ', set keywords = list_append(keywords, :tags)' : '')
                + (event.date ? ', set date = :date' : ''),
                ExpressionAttributeValues: {
                    ':tags': event.keywords,
                    ':date': event.date
                }
            }, callback);
        });
    } else {
        s3.listObjects({
            Bucket: event.bucket,
            MaxKeys: 1000
        }, (err, data) => {
            if (err) {
                callback(err);
                return;
            }
            data.Contents.forEach(file => {
                const keyParts = file.Key.split('/');
                dynamo.update({
                    TableName: 'pasicrisie_documents',
                    Key: {_id: keyParts[keyParts.length - 1].replace(/\.[^.]+$/, '')},
                    UpdateExpression: 'searchable = true'
                }, err => {if(err) console.error(err);});
            });
            callback(undefined, data.NextMarker);
        });
    }
};
