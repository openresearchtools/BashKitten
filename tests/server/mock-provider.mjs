import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function createMockProvider(port = 0) {
  const requests = [];
  const server = http.createServer(async (req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const input=JSON.parse(text);requests.push(input);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const send=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'mock-'+requests.length,object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const lastUser=[...input.messages].reverse().find(m=>m.role==='user');
    const content=typeof lastUser?.content==='string'?lastUser.content:JSON.stringify(lastUser?.content);
    const afterUser=input.messages.slice(input.messages.lastIndexOf(lastUser)+1);
    const hasResult=afterUser.some(m=>m.role==='tool');
    const toolSteps = [
      ['write', {path:'native-tools.txt',content:'before native edit\n'}],
      ['edit', {path:'native-tools.txt',oldText:'before native edit',newText:'after native edit'}],
      ['read', {path:'native-tools.txt'}],
      ['bash', {command:'pwd && cat native-tools.txt'}],
      ['grep', {pattern:'after native edit',path:'.'}],
      ['find', {pattern:'native-tools.txt',path:'.'}],
      ['ls', {path:'.'}]
    ];
    const nextTool = input.tools?.length && content?.includes('ALL_TOOLS_FIXTURE') ? toolSteps[afterUser.filter(m=>m.role==='tool').length] : null;
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    send({role:'assistant'});
    if(content?.includes('SLOW'))await wait(1500);
    if(res.destroyed)return;
    const tool=input.tools?.find(t=>t.function.name==='read');
    if(nextTool) {
      const [name,args]=nextTool;
      send({tool_calls:[{index:0,id:'call_'+name,type:'function',function:{name,arguments:JSON.stringify(args)}}]});send({},'tool_calls');
    }else if(content?.includes('READ_FIXTURE')&&!hasResult&&tool) {
      send({reasoning_content:'I will read the working folder fixture.'});
      send({tool_calls:[{index:0,id:'call_fixture',type:'function',function:{name:'read',arguments:''}}]});
      send({tool_calls:[{index:0,function:{arguments:JSON.stringify({path:'fixture.txt'})}}]});
      send({},'tool_calls');
    }else{
      send({reasoning_content:'Checking the native session context.'});await wait(60);
      const output=hasResult?'Read fixture successfully: '+afterUser.find(m=>m.role==='tool').content:input.tools?'Native Pi reply: '+(content||'').slice(0,100):'## Goal\nVerify native Pi RPC.\n## Progress\nFixture work completed.\n## Next steps\nContinue the user request.';
      for(const word of output.match(/.{1,20}/gs)||[]){send({content:word});await wait(20);}
      send({},'stop');
    }
    res.write('data: '+JSON.stringify({id:'usage',choices:[],usage:{prompt_tokens:160,completion_tokens:40,total_tokens:200,prompt_tokens_details:{cached_tokens:20}}})+'\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,requests,port:server.address().port,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
export async function configureMockPi(agentDir,port){
  await fs.mkdir(agentDir,{recursive:true,mode:0o700});
  await fs.writeFile(path.join(agentDir,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${port}/v1`,api:'openai-completions',apiKey:'fixture-key',models:[{id:'fixture',name:'Local RPC fixture',reasoning:true,input:['text','image'],contextWindow:8192,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:{supportsDeveloperRole:false,supportsReasoningEffort:false}}]}}}));
  await fs.writeFile(path.join(agentDir,'settings.json'),JSON.stringify({defaultProvider:'fixture',defaultModel:'fixture',defaultThinkingLevel:'off',compaction:{enabled:true,reserveTokens:1024,keepRecentTokens:512},retry:{enabled:false}}));
}
if(process.argv.includes('--serve')){const fixture=await createMockProvider(Number(process.env.FIXTURE_PORT||3941));if(process.env.PI_CODING_AGENT_DIR)await configureMockPi(process.env.PI_CODING_AGENT_DIR,fixture.port);console.log('Local deterministic test provider on '+fixture.port);}
