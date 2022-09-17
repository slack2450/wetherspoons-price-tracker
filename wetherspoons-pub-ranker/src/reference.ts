import fs from 'fs';
import _, { split } from 'lodash';
import {variance, sampleCovariance} from 'simple-statistics'

const rawdata = fs.readFileSync('spoonsdata.json', {encoding: 'utf-8'});
const data = JSON.parse(rawdata);

interface pub {
    name: string;
    venueId: number;
    beer: number;
    wine: number;
    spirit: number;
    mahld: number;
    rank: number;
}

let pubs: pub[] = [];
for(const spoons of data) {
    const [beer, wine, spirit]: [number[], number[], number[]] = [[],[],[]];
    const spoonsppu: [number[], number[], number[]] = [[], [], []];
    const spoonsdrinks = spoons['drinks'];
    for(const drink of spoonsdrinks) {
        if(typeof drink.ppu != 'number')
            continue;

        if(drink.price > 100)
            continue;

        if(drink.units <= 1.2) {
            spirit.push(drink.ppu);
        } else if (drink.units <= 4.5) {
            beer.push(drink.ppu);
        } else {
            wine.push(drink.ppu);
        }
    }
    const pub = {
        name: spoons.name,
        venueId: spoons.venueId,
        beer: beer.reduce((a,b) => a + b, 0) / (beer.length != 0 ? beer.length : 1),
        wine: wine.reduce((a,b) => a + b, 0) / (wine.length != 0 ? wine.length : 1),
        spirit: spirit.reduce((a,b) => a + b, 0) / (spirit.length != 0 ? spirit.length : 1),
        mahld: NaN,
        rank: NaN,
    };

    pubs.push(pub)
}

const vspirit   = pubs.map((pub) => pub.spirit);
const vbeer     = pubs.map((pub) => pub.beer);
const vwine     = pubs.map((pub) => pub.wine);

console.log(vspirit);

const mvector = [_.mean(vspirit), _.mean(vbeer), _.mean(vwine)];
const vmatrix = [
    [variance(vspirit), sampleCovariance(vspirit, vbeer), sampleCovariance(vspirit, vwine)],
    [sampleCovariance(vspirit, vbeer), variance(vspirit), sampleCovariance(vbeer, vwine)],
    [sampleCovariance(vspirit, vwine), sampleCovariance(vbeer, vwine), variance(vspirit)]
];

console.log(vmatrix);
console.log(mvector);

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

const malh = [];
for(const pub of pubs) {
    if(pub.wine <= 0 || pub.spirit <= 0)
        continue;

    const euclid = [pub.spirit + -1*mvector[0],pub.beer + -1*mvector[1],pub.wine + -1*mvector[2]];
    const spread = [a*euclid[0] + b*euclid[1] + c*euclid[2], d*euclid[0] + e*euclid[1] + f*euclid[2], g*euclid[0] + h*euclid[1] + i*euclid[2]]
    const malhsquared = euclid[0]*spread[0] + euclid[1]*spread[1] + euclid[2]*spread[2]
    pub.mahld = Math.sqrt(malhsquared);
}

pubs = pubs.filter(pub => !Number.isNaN(pub.mahld))

pubs.sort((a, b) => b.mahld - a.mahld);

let brank = pubs.length;
let trank = 1;
for(const pub of pubs) {
    console.log(pub.spirit + -1*mvector[0] +pub.beer + -1*mvector[1] +pub.wine + -1*mvector[2]);
    if(pub.spirit + -1*mvector[0] +pub.beer + -1*mvector[1] +pub.wine + -1*mvector[2] < 0) {
        pub.rank = trank;
        trank++;
    } else {
        pub.rank = brank;
        brank--;
    }
}

pubs.sort((a, b) => a.rank - b.rank);

console.log(pubs[0]);
console.log(pubs[1]);
console.log(pubs[2]);
console.log(pubs[3]);
console.log(pubs[pubs.length -1]);
console.log(pubs[pubs.length -2]);

for(const pub of pubs) {
    if(pub.venueId == 19)
        console.log(pub);
}