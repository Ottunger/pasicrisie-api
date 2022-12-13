'use strict';

const AWS = require('aws-sdk');
const elasticsearch = require('elasticsearch');
const CognitoExpress = require('cognito-express');

const esClient = new elasticsearch.Client({
    host: '172.31.35.122:9200',
    log: 'error'
});
const cognitoExpress = new CognitoExpress({
    region: 'eu-central-1',
    cognitoUserPoolId: 'eu-central-1_81WWeoPRL',
    tokenUse: 'id',
    tokenExpiration: 3600000,
});

function uniq(a) {
    const seen = {};
    return a.filter(item => seen.hasOwnProperty(item)? false : (seen[item] = true));
}
function matched(challenge, truth, sep) {
    if(!truth) return [];
    if(!challenge) return [true];
    challenge = challenge.trim();
    if(!challenge) return [true];
    const challenges = challenge.split(sep);
    return challenges.map(c =>  truth.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .indexOf(c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()))
        .filter(index => index > -1).map(index => truth.substr(Math.max(0, index - 200), index + 200));
}

exports.handler = (event, context, callback) => {
    const done = (err, res) => {
        if(err) console.error('ENDING REQUEST FAILED', err);
        callback(null, {
            statusCode: err? '400' : '200',
            body: err? '{"message": "' + err.message + '"}' :
                typeof res === 'string'? res : JSON.stringify(res),
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
        });
    };

    event.queryStringParameters = event.queryStringParameters || {};
    let accessTokenFromClient = event.headers.Authorization;
    if(!accessTokenFromClient) {
        done(new Error('No authorization mean found'));
        return;
    }
    cognitoExpress.validate(accessTokenFromClient, (err, user) => {
        console.warn(err);
        console.log(user);
        if(err) {
            done(new Error('Authorization mean is not valid'));
            return;
        }
        user['cognito:groups'] = user['cognito:groups'] || [];
        switch(event.httpMethod) {
            case 'GET':
                if(/\/?api\/me/.test(event.path)) {
                    done(undefined, {result: user});
                } else if(/\/?api\/find-books/.test(event.path)) {
                    if(user['cognito:groups'].indexOf(event.queryStringParameters.kind + '_readers') === -1) {
                        done(new Error('Authorization does not allow this operation'));
                        return;
                    }
                    /**
                     * Accepts the following query string parameters:
                     * -kind: 2017/bulletin/..., the type of book
                     * -dateMin: a minimum date
                     * -dateMax: a maximum date
                     * -author: an author name
                     * -desc: a book description
                     */
                    esClient.search({
                        index: 'documents',
                        q: 'fulltext:\'' + decodeURIComponent(event.queryStringParameters.fulltext) + '\'',
                        type: event.queryStringParameters.kind
                    }, (err, data) => {
                        if(!data || !data.hits) {
                            done(new Error('Cannot find books'));
                            return;
                        }
                        done(err, {
                            result: data.hits.hits.map(hit => {
                                const fulltext = hit._source.fulltext;
                                const firstWord = event.queryStringParameters.fulltext.split(' ').filter(w => w.length > 3)[0];
                                let app = Math.max(0, fulltext.indexOf(firstWord.substr(0, firstWord.length - 3)) - 200);
                                hit._source.fulltext = fulltext.substr(app, 400);
                                while(app > 0 && !/\s[0-9]+\s*\.[^0-9]/.test(hit._source.fulltext)) {
                                    const previousApp = app;
                                    app = Math.max(0, app - 200);
                                    hit._source.fulltext = fulltext.substring(app, previousApp) + hit._source.fulltext;
                                }
                                hit._source.fulltext = hit._source.fulltext.replace(new RegExp(firstWord + '[^\s]*', 'gi'), match => '***' + match + '***');
                                hit._source.distance = fulltext.indexOf(hit._source.fulltext.replace(/\*\*\*/g, '')) / fulltext.length;
                                return hit._source;
                            })
                        });
                    });
                } else if(/\/?api\/find-types/.test(event.path)) {
                    done(undefined, {result: ['bulletin']});
                } else {
                    done(new Error('Unsupported action ' + event.httpMethod + ' ' + event.path));
                }
                break;
            default:
                done(new Error('Unsupported method ' + event.httpMethod));
                break;
        }
    });
};
