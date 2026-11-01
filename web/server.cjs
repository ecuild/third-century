const http=require('http'),fs=require('fs'),path=require('path');
const root=__dirname;
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'};
http.createServer((req,res)=>{
  let u=decodeURIComponent(req.url.split('?')[0]);
  let p=path.join(root,u);
  if(u==='/'||u==='')p=path.join(root,'index.html');
  fs.readFile(p,(e,d)=>{
    if(e){res.writeHead(404);res.end('404 '+p);return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'text/plain'});
    res.end(d);
  });
}).listen(8848,()=>console.log('ok on 8848'));
