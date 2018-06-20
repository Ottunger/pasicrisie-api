'use strict';

const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();
const stream = require('stream');
const rtf2text = require('rtf2text');
const cloudconvert = new (require('cloudconvert'))('JGg1oJt2CqnFjx19Ui6LAj3ue56Ax9rpRz37Mlgjv0ajSRYCIkw7LxPf5AA1UyiD');

const foldersNonFullText = /bulletin\//;
const baseS3Url = 'https://s3.eu-central-1.amazonaws.com/';
const possibleKeywords = ['actes administratifs', 'decisions susceptibles d\'un recours', 'contenu formel d\'une decision administrative', 'effets', 'droits acquis', 'actes reglementaires', 'notion.', 'regime – obligation de motivation – contrôle du juge', 'applications', 'actes reglementaires qui ont ete declares respectivement legaux ou illegaux', 'agriculture', 'quotas laitiers', 'aides agricoles', 'armes prohibees', 'autorisation d\'etablissement', 'principes generaux', 'qualification professionnelle', 'honorabilite professionnelle', 'grandes surfaces commerciales', 'debits de boissons', 'heures d\'ouverture', 'liquidations', 'aides aux entreprises', 'communes', 'autonomie communale', 'organes de la commune', 'divers', 'competence', 'competence des autorites administratives', 'competence des juridictions', 'droits de l\'homme et libertes fondamentales', 'protection contre la torture et les peines ou traitements inhumains oudegradants', 'droit a la liberte et a la sûrete', 'droit a un proces equitable (article 6) – droit a un recours effectif', 'légalité des peines', 'droit au respect de la vie privee et familiale', 'liberte de pensee, de conscience et de religion', 'liberte d\'expression', 'droit au mariage', 'protection de la propriete', 'expulsion d\'etrangers', 'droit à ne pas etre juge ou puni deux fois', 'droits de l\'enfant ', 'elections', 'enseignement', 'entraide judiciaire', 'commissions rogatoires', 'extradition.', 'information sur le droit etranger', 'environnement', 'constructions en zone verte', 'habitat naturel – massifs boises', 'pollution – déchets – décharges – depôts – déblais – remblais', 'information en matiere d\'environnement – evaluation des incidences sur l\'environnement', 'chasse et peche', 'protection de l\'eau – cours d\'eau – sources', 'bruit', 'aides', 'etablissements classes', 'demande d\'autorisation ', 'autorisation', 'cessation – suspension – retrait', 'recours', 'applications particulieres', 'etrangers', 'protection internationale', 'autorisation de sejour – expulsion', 'retention administrative', 'statut d\'apatride. ', 'convention de schengen – reglement «dublin» ', 'experts', 'expropriation pour cause d\'utilite publique', 'finances publiques', 'fonction publique', 'recrutement – stage – nomination', 'promotion', 'classement', 'changement d\'affectation, de fonction ou de service – detachement ', 'domicile – logement de service', 'discipline', 'traitement – allocations – indemnites', 'conge – amenagement du temps de travail', 'frais de route', 'demission', 'mise a la retraite – maintien en service – pension – reintegration', 'etablissements publics', 'employes publics', 'protection du fonctionnaire', 'divers', 'impôts', 'legislation concernant les impôts – principes d\'imposition', 'domicile fiscal et sejour habituel', 'impôt sur le revenu', 'impôt sur le revenu des collectivites', 'impôt sur la fortune .', 'impôt commercial', 'impôt foncier', 'taxes communales', 'autres taxes', 'prescription', 'remise gracieuse', 'procedure administrative', 'procedure contentieuse', 'droit international', 'langues', 'logement', 'lois et reglements', 'marches publics', 'noms – prenoms – domicile – etat civil – nationalite', 'postes et telecommunications', 'personnel', 'services postaux – telecommunications', 'pratiques commerciales', 'procedure administrative non contentieuse', 'champ d\'application', 'obligation de collaboration de l\'administration', 'avis d\'organismes consultatifs', 'motivation de la decision administrative', 'respect du principe du contradictoire', 'communication du dossier administratif et des elements d\'information', 'information des tiers – publicite des decisions administratives', 'recours gracieux – recours hierarchique', 'decision a prendre en dehors de l\'initiative de l\'administre – retrait d\'un acte administratif', 'droit d\'etre assiste ou de se faire representer par un conseil', 'information concernant les voies de recours', 'mediateur', 'divers', 'procedure contentieuse', 'interêt a agir', 'capacite – qualite pour agir .', 'delai pour agir', 'releve de la decheance encourue par l\'expiration d\'un delai', 'requete introductive d\'instance ', 'sursis à execution – mesures de sauvegarde (référé administratif) – effet suspensif ordonné par le tribunal', 'production de pieces et du dossier administratif – mesures d\'instruction', 'echange de memoires', 'renvoi prejudiciel', 'jugement', 'appel', 'autres voies de recours', 'frais – indemnite de procedure – assistance judiciaire', 'execution des jugements et arrets', 'desistement', 'protection des donnees', 'recours en annulation', 'cas d\'ouverture', 'pouvoirs du juge', 'divers', 'recours en reformation', 'régulation économique', 'contrôle du marche des assurances', 'contrôle du marche de l’electricite', 'contrôle du secteur financier', 'contrôle du secteur des telecommunications', 'sante publique', 'securite sociale', 'sites et monuments', 'transports', 'transport terrestre', 'transport aerien', 'transport par eau', 'depôt douanier', 'travail', 'contrat de travail', 'conventions collectives de travail', 'permis de travail', 'comites mixtes dans les entreprises – delegations du personnel – elections sociales', 'travail dominical', 'syndicats', 'chambres professionnelles', 'demandeurs d\'emploi (indemnites de chômage) – aides professionnelles', 'tutelle administrative', 'pouvoirs et obligations de l\'autorite de tutelle', 'recours contentieux', 'tutelle en matiere de plans d\'amenagement', 'tutelle en d’autres matieres', 'urbanisme', 'plans directeurs, plans d\'occupation des sols, etc', 'plan d\'aménagement général et règlement sur les bâtisses ', 'plan d\'amenagement et reglement sur les batisses de la ville de luxembourg', 'autres plans d\'amenagement et reglements sur les batisses', 'plan d\'amenagement particulier', 'remembrement urbain et rural.', 'autorisations de construire', 'dispositions transitoires de la loi du 19 juillet 2004', 'voirie'];

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
            const matcher = /[^0-9]([0-9]{5}[A-Z]?)[^0-9A-Z]/g, done = {};
            let matched;
            while((matched = matcher.exec(fulltext)) !== null) {
                if(!done[matched[1]]) {
                    done[matched[1]] = true;
                    rtf = rtf.replace(new RegExp('[^0-9]' + matched[1] + '[^0-9A-Z]', 'g'), t => {
                        const firstLetter = t.substring(0, 1), body = t.substring(1, t.length - 1), lastLetter = t.substring(t.length - 1);
                        return firstLetter + '{\\colortbl ;\\red0\\green0\\blue238;}\n'
                            + '{\\field{\\*\\fldinst HYPERLINK "' + baseS3Url + bucket.replace('raw-rtf', 'pdf') + '/'
                            + key.replace(/[0-9]{5}[A-Z]?/, body).replace('rtf', 'pdf') + '"}{\\fldrslt{\\ul\\cf1 ' + body + '}}}' + lastLetter;
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
