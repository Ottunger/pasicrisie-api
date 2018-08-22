'use strict';

const AWS = require('aws-sdk');
const cs = new AWS.CloudSearchDomain({endpoint: 'search-pasicrisie-4wqicx6rj444xcjcbos3hamuyy.eu-central-1.cloudsearch.amazonaws.com'});
const CognitoExpress = require('cognito-express');

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
        user['cognito:groups'] = user['cognito:groups'] || [];
        if(err) {
            done(new Error('Authorization mean is not valid'));
            return;
        }
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
                    cs.search({
                        query: decodeURIComponent(event.queryStringParameters.fulltext),
                        filterQuery: 'kind:\'' + event.queryStringParameters.kind + '\'',
                        highlight: JSON.stringify({fulltext: {format: 'text', pre_tag: '***', post_tag: '***'}})
                    }, (err, data) => {
                        if(!data || !data.hits) {
                            done(new Error('Cannot find books'));
                            return;
                        }
                        done(err, {
                            result: data.hits.hit.map(hit => {
                                if(hit.highlights.fulltext.indexOf('***') > -1)
                                    hit.fields.fulltext = [hit.highlights.fulltext];
                                else {
                                    const firstWord = event.queryStringParameters.fulltext.split(' ').filter(w => w.length > 3)[0];
                                    const app = hit.fields.fulltext[0].indexOf(firstWord.substr(0, firstWord.length - 3));
                                    hit.fields.fulltext = [hit.fields.fulltext[0].substr(Math.max(0, app - 200), 400)
                                        .replace(new RegExp(firstWord + '[^\s]*', 'gi'), match => '***' + match + '***')];
                                }
                                return hit.fields;
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
