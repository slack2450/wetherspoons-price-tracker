import { mean } from 'lodash';
import {variance, sampleCovariance} from 'simple-statistics'

// Create service client module using ES6 syntax.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Create an Amazon DynamoDB service client object.
const ddbClient = new DynamoDBClient({ region: 'eu-west-2' });

import { DynamoDBDocumentClient, PutCommand, ScanCommand, ScanCommandInput } from "@aws-sdk/lib-dynamodb";
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

interface Drink {
    name: string;
    units: number;
    productId: number;
    price: number;
}

interface Pub {
    venueId: number;
    date: number;
    drinks: Drink[];
    beerAvgPPU: number;
    wineAvgPPU: number;
    spiritAvgPPU: number;
    mahld: number;
    rank: number;
}

export const handler = async() => {
    const date = new Date().setHours(0, 0, 0, 0);

    const pubs: Pub[] = [];

    const params: ScanCommandInput = {
        TableName: 'wetherspoons-pubs',
        IndexName: 'DateIndex',
        FilterExpression: '#i = :k',
        ExpressionAttributeValues: {
            ':k': date,
        },
        ExpressionAttributeNames: {
            '#i': 'date',
        }
    }

    do {
        const { Items, LastEvaluatedKey} = await ddbDocClient.send(new ScanCommand(params));
        params.ExclusiveStartKey = LastEvaluatedKey;
        if(Items) {
            pubs.push(...Items as Pub[]);
        }
    } while(typeof params.ExclusiveStartKey != "undefined")

    for(const pub of pubs) {
        const beerPPUs: number[] = []
        const winePPUs: number[] = []
        const spiritPPUs: number[] = [];
        for(const drink of pub.drinks) {
            if(drink.price <= 0  || drink.units <= 0)
                continue;
            const ppu = drink.price / drink.units
            if(drink.units <= 1.2) {
                spiritPPUs.push(ppu);
            } else if (drink.units <= 4.5) {
                beerPPUs.push(ppu);
            } else {
                winePPUs.push(ppu);
            }
        }
        pub.beerAvgPPU = beerPPUs.reduce((a,b) => a + b, 0) / (beerPPUs.length != 0 ? beerPPUs.length : 1);
        pub.wineAvgPPU = winePPUs.reduce((a,b) => a + b, 0) / (winePPUs.length != 0 ? winePPUs.length : 1);
        pub.spiritAvgPPU = spiritPPUs.reduce((a,b) => a + b, 0) / (spiritPPUs.length != 0 ? spiritPPUs.length : 1);
        pub.mahld = NaN;
    }

    const vspirit   = pubs.map((pub) => pub.spiritAvgPPU);
    const vbeer     = pubs.map((pub) => pub.beerAvgPPU);
    const vwine     = pubs.map((pub) => pub.wineAvgPPU);

    const mvector = [mean(vspirit), mean(vbeer), mean(vwine)];
    const vmatrix = [
        [variance(vspirit), sampleCovariance(vspirit, vbeer), sampleCovariance(vspirit, vwine)],
        [sampleCovariance(vspirit, vbeer), variance(vspirit), sampleCovariance(vbeer, vwine)],
        [sampleCovariance(vspirit, vwine), sampleCovariance(vbeer, vwine), variance(vspirit)]
    ];

    const det = vmatrix[0][0]*(vmatrix[1][1]*vmatrix[2][2] - vmatrix[1][2]*vmatrix[2][1]) - vmatrix[0][1]*(vmatrix[1][0]*vmatrix[2][2] - vmatrix[1][2]*vmatrix[2][0]) + vmatrix[0][2]*(vmatrix[1][0]*vmatrix[2][1] - vmatrix[1][1]*vmatrix[2][0])
    const a = (1/det)*(vmatrix[1][1]*vmatrix[2][2] - vmatrix[1][2]*vmatrix[2][1])
    const b = (-1/det)*(vmatrix[0][1]*vmatrix[2][2] - vmatrix[0][2]*vmatrix[2][1])
    const c = (1/det)*(vmatrix[0][1]*vmatrix[1][2] - vmatrix[2][0]*vmatrix[1][1])
    const d = (-1/det)*(vmatrix[1][0]*vmatrix[2][2] - vmatrix[1][2]*vmatrix[2][0])
    const e = (1/det)*(vmatrix[0][0]*vmatrix[2][2] - vmatrix[0][2]*vmatrix[2][0])
    const f = (-1/det)*(vmatrix[0][0]*vmatrix[1][2] - vmatrix[0][2]*vmatrix[1][0])
    const g = (1/det)*(vmatrix[1][0]*vmatrix[2][1] - vmatrix[1][1]*vmatrix[2][0])
    const h = (-1/det)*(vmatrix[0][0]*vmatrix[2][1] - vmatrix[0][1]*vmatrix[2][0])
    const i = (1/det)*(vmatrix[0][0]*vmatrix[1][1] - vmatrix[0][1]*vmatrix[1][0])

    for(const pub of pubs) {
        if(pub.wineAvgPPU <= 0 || pub.spiritAvgPPU <= 0 || pub.beerAvgPPU <= 0) {
            continue;
        }
            
        const euclid = [pub.spiritAvgPPU + -1*mvector[0],pub.beerAvgPPU + -1*mvector[1],pub.wineAvgPPU + -1*mvector[2]];
        const spread = [a*euclid[0] + b*euclid[1] + c*euclid[2], d*euclid[0] + e*euclid[1] + f*euclid[2], g*euclid[0] + h*euclid[1] + i*euclid[2]]
        const malhsquared = euclid[0]*spread[0] + euclid[1]*spread[1] + euclid[2]*spread[2];
        pub.mahld = Math.sqrt(malhsquared);
    }

    const rankablePubs: Pub[] = pubs.filter(pub => !Number.isNaN(pub.mahld));

    rankablePubs.sort((a, b) => b.mahld - a.mahld);

    let brank = pubs.length;
    let trank = 1;
    for(const pub of pubs) {
        //console.log(pub.spiritAvgPPU + -1*mvector[0] +pub.beerAvgPPU + -1*mvector[1] +pub.wineAvgPPU + -1*mvector[2]);
        if(pub.spiritAvgPPU + -1*mvector[0] +pub.beerAvgPPU + -1*mvector[1] +pub.wineAvgPPU + -1*mvector[2] < 0) {
            pub.rank = trank;
            trank++;
        } else {
            pub.rank = brank;
            brank--;
        }
    }

    pubs.sort((a, b) => a.rank - b.rank);

    const pubDBData = rankablePubs.map((pub) => {
        return {
            venueId: pub.venueId,
            beerAvgPPU: pub.beerAvgPPU,
            wineAvgPPU: pub.wineAvgPPU,
            spiritAvgPPU: pub.spiritAvgPPU,
            mahld: pub.mahld,
            rank: pub.rank,
        }
    });

    const rankings = {
        date,
        pubs: pubDBData
    }

    const command = new PutCommand({ TableName: 'wetherspoons-pub-rankings', Item: rankings });

    await ddbDocClient.send(command);
}