// Mesure de la signature sonore FlixTunes.
//
//   node tools/mesure-signature.mjs <fichier.wav> [autres.wav...]
//
// Trois grandeurs gouvernent un logo sonore, et elles ne varient pas ensemble. Les confondre est
// l'erreur qui produit un son gros mais mou et âpre.
//
//   PUNCH        temporel. Contraste entre le transitoire et le corps qui suit, d'après le modèle
//                de punch perçu fondé sur la loudness transitoire pondérée. Il s'obtient par un
//                temps de montée court — jamais en ajoutant de l'aigu.
//   SHARPNESS    spectral. Pondération de l'énergie vers l'aigu (Zwicker, en acum). C'est elle
//                qui rend un son perçant, donc agressif.
//   DISSONANCE   spectral. Somme des interactions de Plomp & Levelt (1965) entre partiels : la
//                rugosité culmine lorsque deux partiels sont séparés d'un quart de bande critique,
//                soit une tierce mineure dans le grave.
//
// Les implémentations sont simplifiées. Ce qui compte ici est la comparaison entre deux versions
// d'un même son, pas une valeur absolue certifiée.

import fs from 'node:fs';

function lire(chemin) {
  const b = fs.readFileSync(chemin);
  let pos = 12, rate = 48000, voies = 2, bits = 16, data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4), taille = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') { voies = b.readUInt16LE(pos + 10); rate = b.readUInt32LE(pos + 12); bits = b.readUInt16LE(pos + 22); }
    if (id === 'data') { data = b.subarray(pos + 8, pos + 8 + taille); break; }
    pos += 8 + taille + (taille & 1);
  }
  if (!data) throw new Error(`${chemin} : pas de bloc « data ».`);
  const octets = bits / 8, n = Math.floor(data.length / (octets * voies));
  const L = new Float64Array(n), R = new Float64Array(n), mono = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = data.readInt16LE(i * octets * voies) / 32768;
    R[i] = voies > 1 ? data.readInt16LE(i * octets * voies + octets) / 32768 : L[i];
    mono[i] = (L[i] + R[i]) / 2;
  }
  return { rate, n, L, R, mono };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let pas = 2; pas <= n; pas <<= 1) {
    const ang = -2 * Math.PI / pas;
    for (let i = 0; i < n; i += pas) {
      for (let k = 0; k < pas / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + pas / 2] * wr - im[i + k + pas / 2] * wi;
        const vi = re[i + k + pas / 2] * wi + im[i + k + pas / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + pas / 2] = ur - vr; im[i + k + pas / 2] = ui - vi;
      }
    }
  }
}

function spectre(buf, depart, longueur, rate) {
  let n = 1; while (n < longueur) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < longueur && depart + i < buf.length; i++) {
    re[i] = buf[depart + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / longueur)); // Hann
  }
  fft(re, im);
  const moitie = n >> 1, mag = new Float64Array(moitie);
  for (let i = 0; i < moitie; i++) mag[i] = Math.hypot(re[i], im[i]) / (longueur / 2);
  return { mag, df: rate / n };
}

const bark = (f) => 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan((f / 7500) ** 2);
// Largeur de bande critique, Zwicker & Terhardt.
const bandeCritique = (f) => 25 + 75 * (1 + 1.4 * (f / 1000) ** 2) ** 0.69;

// Seuil absolu d'audition, approximation de Terhardt, en dB SPL.
const seuilAudition = (f) => {
  const k = Math.max(f, 20) / 1000;
  return 3.64 * Math.pow(k, -0.8) - 6.5 * Math.exp(-0.6 * (k - 3.3) ** 2) + 1e-3 * k ** 4;
};

// Sharpness de Zwicker : centre de gravité des loudness spécifiques, pondéré par g(z) qui croît
// fortement au-delà de 16 Bark.
//
// Le plancher d'audibilité n'est pas un raffinement, c'est ce qui rend la mesure utilisable. La
// loudness spécifique passe par une racine quatrième, qui écrase tout : sans plancher, une bande
// à −120 dBFS pèse encore le tiers d'une bande à −20, et la sharpness se met à décrire du contenu
// que personne n'entend. Comparées ainsi, deux versions d'un même son affichaient 0,72 et 1,27
// acum alors que toutes deux avaient moins de 0,1 % de leur énergie au-dessus de 2 kHz.
//
// Le calage suppose qu'une sinusoïde pleine échelle vaut 100 dB SPL, ce qui correspond à une
// écoute forte. Ce qui compte est la cohérence entre fichiers comparés, pas la valeur absolue.
function sharpness(mag, df) {
  const bandes = new Float64Array(25);
  const centres = new Float64Array(25);
  const compte = new Float64Array(25);
  for (let i = 1; i < mag.length; i++) {
    const f = i * df;
    if (f < 20 || f > 15000) continue;
    const z = Math.min(24, Math.floor(bark(f)));
    bandes[z] += mag[i] * mag[i];
    centres[z] += f; compte[z]++;
  }
  let num = 0, den = 0;
  for (let z = 0; z < 25; z++) {
    if (bandes[z] <= 0 || compte[z] === 0) continue;
    const niveau = 10 * Math.log10(bandes[z]) + 100;
    if (niveau < seuilAudition(centres[z] / compte[z])) continue; // inaudible : ne compte pas
    const N = Math.pow(bandes[z], 0.25);
    const g = z < 16 ? 1 : 0.066 * Math.exp(0.171 * z);
    num += N * g * (z + 0.5); den += N;
  }
  return den > 0 ? 0.11 * num / den : 0;
}

// Dissonance sensorielle de Plomp & Levelt, sommée sur les paires de partiels détectés.
function partiels(mag, df, plancher = 60, plafond = 5000) {
  const pics = [];
  for (let i = 2; i < mag.length - 2; i++) {
    const f = i * df;
    if (f < plancher || f > plafond) continue;
    if (mag[i] > mag[i - 1] && mag[i] >= mag[i + 1] && mag[i] > 1e-4) pics.push([f, mag[i]]);
  }
  return pics.sort((a, b) => b[1] - a[1]).slice(0, 24);
}

function dissonance(pics) {
  let d = 0, norme = 0;
  for (let a = 0; a < pics.length; a++) {
    for (let b = a + 1; b < pics.length; b++) {
      const [f1, a1] = pics[a], [f2, a2] = pics[b];
      const s = Math.abs(f2 - f1) / bandeCritique((f1 + f2) / 2);
      // Courbe de Plomp-Levelt : nulle à l'unisson, maximale vers un quart de bande critique.
      d += a1 * a2 * (Math.exp(-3.5 * s) - Math.exp(-5.75 * s));
      norme += a1 * a2;
    }
  }
  return norme > 0 ? d / norme : 0;
}

const passeHaut = (x, rate, fc) => {
  const a = 1 / (1 + 2 * Math.PI * fc / rate), y = new Float64Array(x.length);
  let pi = 0, po = 0;
  for (let i = 0; i < x.length; i++) { const v = a * (po + x[i] - pi); y[i] = v; pi = x[i]; po = v; }
  return y;
};

const rms = (x, de, a) => {
  let e = 0, c = 0;
  for (let i = Math.max(0, Math.round(de)); i < Math.min(x.length, Math.round(a)); i++) { e += x[i] * x[i]; c++; }
  return Math.sqrt(e / Math.max(1, c));
};

function attaque(x, rate) {
  let onset = 0, meilleur = 0;
  const w = Math.round(rate * 0.005);
  for (let s = 0; s + w < x.length && s < rate * 0.5; s += Math.round(rate * 0.001)) {
    let e = 0; for (let i = s; i < s + w; i++) e += x[i] * x[i];
    if (e > meilleur) { meilleur = e; onset = s; }
  }
  return onset;
}

// Le corps est mesuré de 120 à 320 ms après l'attaque : au-delà, le motif entre dans la fenêtre
// et l'on mesurerait la musique au lieu de la décroissance de l'impact.
const punch = (x, rate, onset) =>
  20 * Math.log10(rms(x, onset - rate * 0.002, onset + rate * 0.030) / rms(x, onset + rate * 0.120, onset + rate * 0.320));

const nomNote = (f) => {
  const noms = ['do', 'do#', 'ré', 'mib', 'mi', 'fa', 'fa#', 'sol', 'lab', 'la', 'sib', 'si'];
  const n = Math.round(12 * Math.log2(f / 440)) + 69;
  return `${noms[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
};

const fichiers = process.argv.slice(2);
if (fichiers.length === 0) {
  console.error('usage : node tools/mesure-signature.mjs <fichier.wav> [autres.wav...]');
  process.exit(2);
}

const col = (v, n) => String(v).padStart(n);
const releves = [];

for (const chemin of fichiers) {
  const { rate, n, L, R, mono } = lire(chemin);

  let pic = 0, carre = 0, monoCarre = 0, stereoCarre = 0, satures = 0;
  for (let i = 0; i < n; i++) {
    pic = Math.max(pic, Math.abs(L[i]), Math.abs(R[i]));
    carre += (L[i] ** 2 + R[i] ** 2) / 2;
    stereoCarre += (L[i] ** 2 + R[i] ** 2) / 2;
    monoCarre += mono[i] ** 2;
    if (Math.abs(L[i]) >= 0.9999 || Math.abs(R[i]) >= 0.9999) satures++;
  }
  const valeurRms = Math.sqrt(carre / n);

  // Temps de montée 10 % → 90 % du sommet local, la définition usuelle. Un seuil bas — 2 %, par
  // exemple — s'accroche à l'appel d'air qui précède l'impact et annonce une montée de plusieurs
  // dizaines de millisecondes là où le signal atteint en réalité sa crête en une demie.
  const onset = attaque(mono, rate);
  let creteLocale = 0, sommet = onset;
  for (let i = Math.max(0, onset - Math.round(rate * 0.01)); i < onset + rate * 0.03 && i < n; i++) {
    if (Math.abs(mono[i]) > creteLocale) { creteLocale = Math.abs(mono[i]); sommet = i; }
  }
  let debut = sommet;
  for (let i = sommet; i >= Math.max(0, sommet - Math.round(rate * 0.05)); i--) {
    if (Math.abs(mono[i]) <= 0.10 * creteLocale) { debut = i; break; }
  }
  let neuf = sommet;
  for (let i = debut; i <= sommet; i++) {
    if (Math.abs(mono[i]) >= 0.9 * creteLocale) { neuf = i; break; }
  }
  sommet = neuf;

  const petit = passeHaut(mono, rate, 250);
  const queueDepart = Math.round(n * 0.62);
  const sQueue = spectre(mono, queueDepart, Math.round(rate * 0.30), rate);
  const sTrans = spectre(mono, onset, Math.round(rate * 0.050), rate);
  const sTout = spectre(mono, 0, Math.min(n, Math.round(rate * 1.6)), rate);
  const picsQueue = partiels(sQueue.mag, sQueue.df);

  releves.push({
    nom: chemin.split(/[\\/]/).pop().replace(/\.wav$/i, ''),
    duree: n / rate,
    pic: 20 * Math.log10(pic),
    rms: 20 * Math.log10(valeurRms),
    crete: 20 * Math.log10(pic / valeurRms),
    satures,
    punch: punch(mono, rate, onset),
    punchPetit: punch(petit, rate, attaque(petit, rate)),
    montee: (sommet - debut) / rate * 1000,
    sharp: sharpness(sTout.mag, sTout.df),
    sharpTrans: sharpness(sTrans.mag, sTrans.df),
    dissonance: dissonance(picsQueue),
    restePetit: 20 * Math.log10(rms(petit, 0, n) / rms(mono, 0, n)),
    mono: 10 * Math.log10(monoCarre / stereoCarre),
    picsQueue,
  });
}

console.log('');
console.log('  ' + 'fichier'.padEnd(22) + col('durée', 7) + col('pic', 8) + col('RMS', 8) + col('crête', 8) + col('sat.', 6));
console.log('  ' + ''.padEnd(22) + col('s', 7) + col('dBFS', 8) + col('dBFS', 8) + col('dB', 8) + col('n', 6));
console.log('  ' + '-'.repeat(59));
for (const r of releves) {
  console.log('  ' + r.nom.padEnd(22) + col(r.duree.toFixed(2), 7) + col(r.pic.toFixed(1), 8) +
    col(r.rms.toFixed(1), 8) + col(r.crete.toFixed(1), 8) + col(r.satures, 6));
}

console.log('');
console.log('  ' + 'fichier'.padEnd(22) + col('PUNCH', 8) + col('petit HP', 10) + col('montée', 9) + col('reste', 8));
console.log('  ' + ''.padEnd(22) + col('dB', 8) + col('dB', 10) + col('ms', 9) + col('dB', 8));
console.log('  ' + '-'.repeat(57));
for (const r of releves) {
  console.log('  ' + r.nom.padEnd(22) + col(r.punch.toFixed(1), 8) + col(r.punchPetit.toFixed(1), 10) +
    col(r.montee.toFixed(1), 9) + col(r.restePetit.toFixed(1), 8));
}

console.log('');
console.log('  ' + 'fichier'.padEnd(22) + col('sharp', 8) + col('sh. tr.', 9) + col('disson.', 9) + col('mono', 8));
console.log('  ' + ''.padEnd(22) + col('acum', 8) + col('acum', 9) + col('P-L', 9) + col('dB', 8));
console.log('  ' + '-'.repeat(56));
for (const r of releves) {
  console.log('  ' + r.nom.padEnd(22) + col(r.sharp.toFixed(2), 8) + col(r.sharpTrans.toFixed(2), 9) +
    col(r.dissonance.toFixed(3), 9) + col(r.mono.toFixed(2), 8));
}

for (const r of releves) {
  const paires = [];
  for (let a = 0; a < r.picsQueue.length; a++) {
    for (let b = a + 1; b < r.picsQueue.length; b++) {
      const [f1, a1] = r.picsQueue[a], [f2, a2] = r.picsQueue[b];
      const s = Math.abs(f2 - f1) / bandeCritique((f1 + f2) / 2);
      paires.push([a1 * a2 * (Math.exp(-3.5 * s) - Math.exp(-5.75 * s)), f1, f2, s]);
    }
  }
  paires.sort((x, y) => y[0] - x[0]);
  console.log(`\n  ${r.nom} — paires les plus rugueuses de la queue :`);
  for (const [, f1, f2, s] of paires.slice(0, 3)) {
    console.log(`    ${f1.toFixed(0)} Hz (${nomNote(f1)}) + ${f2.toFixed(0)} Hz (${nomNote(f2)}) — ${s.toFixed(2)} bande critique`);
  }
}

console.log('');
console.log('  PUNCH    transitoire (30 ms) rapporté au corps (120-450 ms). Plus haut = plus percutant.');
console.log('  petit HP le même contraste une fois le grave coupé à 250 Hz, comme sur un téléphone.');
console.log('  crête    pic / RMS. Plus haut = plus dynamique, moins fatigant à volume égal.');
console.log('  sharp    sharpness de Zwicker. Plus BAS = moins perçant, donc moins agressif.');
console.log('  disson.  dissonance de Plomp-Levelt. La rugosité culmine vers 0,25 bande critique ;');
console.log('           au-delà d\'une bande, l\'oreille sépare les deux sons et rien n\'est rugueux.');
console.log('  mono     perte à la somme des deux voies. 0 = rien ne s\'annule.');
console.log('');
