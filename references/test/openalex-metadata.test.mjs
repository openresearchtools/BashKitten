// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import {translateOpenAlex, toCSL} from '../translation.mjs';
import {openAlexRecord} from '../adapted/openalex.mjs';
import {NativeComponents} from '../native.mjs';
import {renderDocument} from '../citations.mjs';
const raw={
 id:'https://openalex.org/W123456789', type:'article', title:'  Synthetic &amp; mapped\nmetadata\u0000  ', publication_date:'2026-10-29',language:'en',
 doi:'https://doi.org/10.1234/SYNTHETIC',
 ids:{openalex:'W123456789', DOI:'10.1234/synthetic',PMID:'https://pubmed.ncbi.nlm.nih.gov/12345678/', PMCID:'https://pmc.ncbi.nlm.nih.gov/articles/PMC12345678/',arxiv:'https://arxiv.org/abs/2610.12345v2'},
 primary_location:{source:{display_name:'Synthetic &amp; Journal',host_organization_name:'Example &amp; Publisher',issn:['1234-5678'],type:'journal'},landing_page_url:'https://example.invalid/work',license:'cc-by'},
 biblio:{volume:12,issue:'4',first_page:120,last_page:133},
 authorships:[
  {author:{id:'https://openalex.org/A123456789',display_name:'Example Research Group',fieldMode:1}},
  {author:{display_name:'John van der Waals',given:'John',family:'van der Waals',orcid:'https://orcid.org/0000-0002-1825-0097'}},
  {author:{display_name:'Prince'}},
  {author:{display_name:'Ludwig van Beethoven'}},
  {author:{display_name:'García Márquez, Gabriel',name:'García Márquez, Gabriel'}},
  {author:{display_name:{invalid:true}}},
 ],
 keywords:[{display_name:'Synthetic &amp; Test'},null],
 abstract_inverted_index:{A:[0],valid:[1],synthetic:[2],'abstract.':[3]},
};
const record=openAlexRecord(raw);
const [mapped] = await translateOpenAlex(raw);
test('all strict work identifiers use one canonical owner',async()=>{
 assert.deepEqual(record.identifiers,{OpenAlex:'W123456789',DOI:'10.1234/synthetic',PMID:'12345678',PMCID:'PMC12345678',arXiv:'2610.12345'});
});
test('native translator maps bibliographic fields and sanitizes provider strings',async()=>{

 assert.equal(mapped.title,'Synthetic & mapped metadata');assert.equal(mapped.publicationTitle,'Synthetic & Journal');
 assert.equal(mapped.volume,'12');assert.equal(mapped.issue,'4');assert.equal(mapped.pages,'120-133');assert.equal(mapped.ISSN,'1234-5678');
 assert.equal(mapped.url,'https://example.invalid/work');assert.equal(mapped.rights,'cc-by');
 assert.equal(mapped.publisher,'Example & Publisher');assert.deepEqual(mapped.provenance.identifiers,record.identifiers);
});
test('explicit corporate/structured names override native parsing; ordinary names retain native Zotero parsing',async()=>{
 assert.equal(mapped.creators.length,5);
 assert.deepEqual(mapped.creators[0],{name:'Example Research Group',creatorType:'author',OpenAlex:'https://openalex.org/A123456789'});
 assert.deepEqual(mapped.creators[1],{firstName:'John',lastName:'van der Waals',creatorType:'author',ORCID:'https://orcid.org/0000-0002-1825-0097'});
 assert.equal(mapped.creators[2].name,'Prince');assert.equal(mapped.creators[3].firstName,'Ludwig van');assert.equal(mapped.creators[3].lastName,'Beethoven');assert.equal(mapped.creators[4].name,'García Márquez, Gabriel');
});
test('display_name is a supported missing-title alias and year is retained',async()=>{
 const [item]=await translateOpenAlex({id:'W2222',type:'book',display_name:'Synthetic book',publication_year:2026,ids:{ISBN:'9780306406157'},authorships:[{author:{given_name:'Alex',family_name:'Example Name'}}]});
 assert.equal(item.title,'Synthetic book');assert.equal(item.date,'2026');assert.equal(item.ISBN,'9780306406157');assert.deepEqual(item.creators,[{firstName:'Alex',lastName:'Example Name',creatorType:'author'}]);
});
test('conflicting aliases fail instead of accepting one DOI or work ID',async()=>{
 assert.throws(()=>openAlexRecord({...raw,ids:{...raw.ids,doi:'10.1234/different'}}),e=>e.status===409);
 assert.throws(()=>openAlexRecord({...raw,ids:{...raw.ids,openalex:'W9999'}}),e=>e.status===409);
});
test('invalid external identifiers do not become editable identity fields',async()=>{
 assert.throws(()=>openAlexRecord({...raw,ids:{...raw.ids,PMID:'malformed'}}));
});
test('strong abstract gaps/collisions and invalid text stay unavailable with explicit provenance',async()=>{
 for(const abstract of [{gap:[2]},{one:[0],two:[0]},'bad\u0000text','x'.repeat(1024*1024+1)]){
  const rec=openAlexRecord({...raw,abstract_inverted_index:typeof abstract==='object'?abstract:undefined,abstract:typeof abstract==='string'?abstract:undefined});
  assert.equal(rec.abstract,'');assert.equal(rec.abstractIssue.status,'unavailable');
 }
 assert.equal(record.abstract,'A valid synthetic abstract.');
});
test('real native worker uses the identical mapping for UI/Pi service calls',async()=>{
 const native=new NativeComponents();try{const [item]=await native.call('translateOpenAlex',[raw]);assert.equal(item.OpenAlex,'W123456789');assert.deepEqual(item.creators,mapped.creators);}finally{await native.close();}
});

test('ordinary OpenAlex display names retain native personal-author citation formatting', async () => {
 const [item] = await translateOpenAlex({id:'W7654321',type:'article',title:'Synthetic conventional author',publication_year:2026,
   authorships:[{author:{display_name:'Ada Lovelace'}}]});
 assert.deepEqual(item.creators,[{firstName:'Ada',lastName:'Lovelace',creatorType:'author'}]);
 const id='bkref:synthetic/library/TEST1234';
 assert.deepEqual((await toCSL(item,id)).author,[{family:'Lovelace',given:'Ada'}]);
 const rendered=await renderDocument({style:{id:'apa'},citations:[{id:'native-personal-name',items:[{id}]}],embeddedItems:{[id]:item}});
 assert.equal(rendered.citations[0].text,'(Lovelace, 2026)');
 assert.match(rendered.bibliography.textEntries[0],/^Lovelace, A\. \(2026\)\./);
});
