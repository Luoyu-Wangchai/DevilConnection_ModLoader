'use strict';
// 构建加载器自动更新资产（外置档路线）：build/out/update.zip + update.json
//   update.zip = runtime/external 全部内容平铺（对应游戏 resources/ 下相对路径），不含 app.asar
//   update.json = { version, beta, sha256, asset }，随 release 一起上传
// 用 adm-zip 打包保证正斜杠条目（Compress-Archive 会写反斜杠，运行时解压路径不对）
// 用法：node build/build_update.js
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const AdmZip = require(path.join(root, 'runtime', 'shell', 'node_modules', 'adm-zip'));
const src = path.join(root, 'runtime', 'external');
const out = path.join(root, 'build', 'out');
fs.mkdirSync(out, { recursive: true });

const zip = new AdmZip();
(function add(dir, rel) {
	for (const name of fs.readdirSync(dir)) {
		const full = path.join(dir, name);
		const r = rel ? rel + '/' + name : name;
		if (fs.statSync(full).isDirectory()) add(full, r);
		else zip.addFile(r, fs.readFileSync(full));
	}
})(src, '');

const zipPath = path.join(out, 'update.zip');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
zip.writeZip(zipPath);

const buf = fs.readFileSync(zipPath);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
const vj = JSON.parse(fs.readFileSync(path.join(src, 'version.json'), 'utf8'));
const manifest = { version: String(vj.version || ''), beta: !!vj.beta, shellVersion: (typeof vj.shellVersion === 'number' ? vj.shellVersion : 1), sha256: sha, asset: 'update.zip' };
fs.writeFileSync(path.join(out, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');

const d = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const dec = String(d.getFullYear() % 100) + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
const hex = parseInt(dec, 10).toString(16).toUpperCase();

console.log('update.zip : ' + zipPath + '  (' + buf.length + ' bytes)');
console.log('sha256     : ' + sha);
console.log('manifest   : version=' + manifest.version + ' beta=' + manifest.beta);
console.log('now stamp  : -' + hex + '  (= ' + dec + ' YYMMDDHHmmss)');
