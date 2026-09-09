const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,POST,OPTIONS'}});
export default {async fetch(req,env){if(req.method==='OPTIONS')return new Response(null,{headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,POST,OPTIONS'}});const u=new URL(req.url);
 if(u.pathname==='/api/health')return json({ready:true,service:'klizonion-builder',version:env.BUILDER_PROTOCOL_VERSION||'0.1'});
 if(u.pathname==='/api/builder/status')return json({runner:false,hardware:'Waiting for local runner',experiment:'Idle',workspace:null});
 if(u.pathname==='/api/builder/start'&&req.method==='POST'){const body=await req.json().catch(()=>({}));return json({accepted:false,message:'No runner is connected. Start the local Builder Runner and pair it with this Worker.',mission:body.mission||null},409)}
 return json({error:'not_found'},404);}}
