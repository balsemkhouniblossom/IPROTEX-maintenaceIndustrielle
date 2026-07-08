 
const fs = require('fs');
const path = require('path');

function readJSON(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }

const scriptDir = path.dirname(module.filename);
const srcDir = path.join(scriptDir,'..','src');
const messagesDir = path.join(scriptDir,'..','messages');
const arPath = path.join(messagesDir,'ar.json');
const ar = readJSON(arPath);

function walk(dir){
  const files=[];
  fs.readdirSync(dir).forEach(f=>{
    const fp = path.join(dir,f);
    const st = fs.statSync(fp);
    if(st.isDirectory()) files.push(...walk(fp));
    else if(fp.endsWith('.tsx')||fp.endsWith('.ts')||fp.endsWith('.jsx')||fp.endsWith('.js')) files.push(fp);
  });
  return files;
}

const files = walk(srcDir);

const nsVars = {}; // varName -> namespace
const usedKeys = {}; // namespace -> Set(keys)

files.forEach(file=>{
  const content = fs.readFileSync(file,'utf8');
  // find all const <var> = useTranslations("ns") occurrences
  const varMatches = [...content.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*['\"]([^'\"]+)['\"]\s*\)/g)];
  varMatches.forEach(m=>{
    const v = m[1]; const ns = m[2];
    nsVars[v]=ns;
    if(!usedKeys[ns]) usedKeys[ns]=new Set();
  });
  // find calls like tSomething("key.path") where tSomething is a var mapped above
  Object.keys(nsVars).forEach(v=>{
    const regex = new RegExp(v+"\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)", 'g');
    const matches = [...content.matchAll(regex)];
    matches.forEach(mm=>{
      const key = mm[1];
      const ns = nsVars[v];
      usedKeys[ns].add(key);
    });
  });
  // Also capture default `t(` variable if present
  if(content.includes('const t = useTranslations(')){
    const m = content.match(/const\s+t\s*=\s*useTranslations\(\s*['\"]([^'\"]+)['\"]\s*\)/);
    if(m){
      const ns = m[1];
      if(!usedKeys[ns]) usedKeys[ns]=new Set();
      const regex = /\bt\(\s*['\"]([^'\"]+)['\"]\s*\)/g;
      const matches = [...content.matchAll(regex)];
      matches.forEach(mm=> usedKeys[ns].add(mm[1]));
    }
  }
});

function existsIn(obj, path){
  const parts = path.split('.');
  let cur = obj;
  for(const p of parts){
    if(cur && Object.prototype.hasOwnProperty.call(cur,p)) cur = cur[p];
    else return false;
  }
  return true;
}

const missing = {};
for(const ns of Object.keys(usedKeys)){
  const keys = Array.from(usedKeys[ns]);
  keys.forEach(k=>{
    // check in ar
    if(!existsIn(ar, k) && !existsIn(ar, ns+'.'+k)){
      if(!missing[ns]) missing[ns]=new Set();
      missing[ns].add(k);
    }
  });
}

// Output missing keys
const out = {};
for(const ns in missing){ out[ns]=Array.from(missing[ns]); }
console.log(JSON.stringify(out, null, 2));

// Also write a helper file to be used by next steps
fs.writeFileSync(path.join(scriptDir,'..','i18n-missing.json'), JSON.stringify(out, null, 2));

console.log('Wrote i18n-missing.json');
