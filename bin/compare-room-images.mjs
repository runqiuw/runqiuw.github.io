// Compare matching PNGs, including named detail crops and motion-frame sequences.
// Both directories need an identical manifest.json describing environment, states and crops.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import sharp from 'sharp';

const [beforeArg, afterArg, reportArg] = process.argv.slice(2);
if (!beforeArg || !afterArg) throw Error('Usage: node bin/compare-room-images.mjs BEFORE_DIR AFTER_DIR [REPORT.json]');
const before = resolve(beforeArg), after = resolve(afterArg);
const manifest = dir => JSON.parse(readFileSync(resolve(dir,'manifest.json'),'utf8'));
const a = manifest(before), b = manifest(after);
// Sorting keys avoids treating harmless object key order as a difference.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
assert.deepEqual(canonical(a), canonical(b), 'Capture manifests differ: compare identical environments, states and crop coordinates');
assert(a.environment && Array.isArray(a.images) && a.images.length, 'Manifest needs environment and nonempty images');
const file = (dir, name) => {
  assert(typeof name === 'string' && name.endsWith('.png'), 'Each image file must be a PNG path');
  const path = resolve(dir,name), rel=relative(dir,path);
  assert(rel && !rel.startsWith('..') && !isAbsolute(rel), `Image escapes capture directory: ${name}`);
  assert(existsSync(path), `Missing image: ${path}`);
  return path;
};
const results = [];
for (const image of a.images) {
  assert(image.file && typeof image.file === 'string', 'Missing image file');
  const [first, second] = await Promise.all([file(before,image.file),file(after,image.file)].map(p=>sharp(p).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true})));
  assert.equal(first.info.width,second.info.width,`${image.file}: width changed`);
  assert.equal(first.info.height,second.info.height,`${image.file}: height changed`);
  const {width,height}=first.info;
  const regions=[{name:'whole',left:0,top:0,width,height},...(image.crops??[])];
  for(const r of regions){
    assert(typeof r.name==='string' && [r.left,r.top,r.width,r.height].every(Number.isInteger) && r.left>=0 && r.top>=0 && r.width>0 && r.height>0 && r.left+r.width<=width && r.top+r.height<=height,`${image.file}: invalid crop ${JSON.stringify(r)}`);
    let changed=0,max=0;
    for(let y=r.top;y<r.top+r.height;y++)for(let x=r.left;x<r.left+r.width;x++){
      const offset=(y*width+x)*4;let different=false;
      for(let c=0;c<4;c++){const d=Math.abs(first.data[offset+c]-second.data[offset+c]);max=Math.max(max,d);different ||= d!==0;}
      changed+=Number(different);
    }
    const result={file:image.file,region:r.name,pixels:r.width*r.height,changedPixels:changed,maxChannelDifference:max};
    results.push(result);console.log(`${changed?'DIFF':'PASS'} ${image.file} / ${r.name}: ${changed} pixels, max channel difference ${max}`);
  }
}
const report={identical:results.every(r=>r.changedPixels===0),results};
if(reportArg)writeFileSync(resolve(reportArg),JSON.stringify(report,null,2)+'\n');
if(!report.identical)process.exitCode=1;
