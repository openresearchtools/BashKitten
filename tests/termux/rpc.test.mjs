import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonLines, translateEvent, activeBranch } from '../../termux/rpc.mjs';
test('RPC records split only on LF and preserve Unicode separators',()=>{const values=[],parser=new JsonLines(v=>values.push(v));parser.push('{"text":"a\u2028b\u2029c"}\r');parser.push('\n{"ok":true}\n');assert.deepEqual(values,[{text:'a\u2028b\u2029c'},{ok:true}]);});
test('Pi event mapping keeps thinking, arguments and tool output distinct',()=>{assert.deepEqual(translateEvent({type:'message_update',assistantMessageEvent:{type:'thinking_delta',delta:'plan'}}),{type:'thinking_delta',delta:'plan'});const event={type:'tool_execution_update',toolCallId:'x',toolName:'bash',partialResult:{content:[{type:'text',text:'output'}]}};assert.equal(translateEvent(event).type,'tool_update');assert.equal(translateEvent(event).partialResult,event.partialResult);});
test('History follows Pi leaf ancestry, retaining compactions and excluding abandoned branches',()=>{const entries=[{id:'a',parentId:null},{id:'b',parentId:'a'},{id:'c',parentId:'a',type:'compaction'}];assert.deepEqual(activeBranch(entries,'c'),[entries[0],entries[2]]);});
