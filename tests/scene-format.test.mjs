import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateScene} from '../dist/scene-format.mjs';
const example=()=>({format:'airlab-4',width:800,height:600,scene:'empty',gravity:'earth',objects:[{kind:'ball',size:27,color:'#b8a2ff',position:{x:100,y:100},velocity:{x:0,y:0},angle:0,spin:0,material:'rubber',frozen:false,bounce:.8}],construction:{platforms:[],portals:[],links:[]}});
test('scene validation accepts bounded scenes and rejects oversized, nonfinite, dangling and malformed inputs',()=>{
 assert.equal(validateScene(example()).objects.length,1);
 for(const change of [s=>s.objects[0].size=Infinity,s=>s.objects[0].color='url(evil)',s=>s.objects.push(...Array(36).fill(s.objects[0])),s=>s.construction.links.push({mode:'rope',a:{body:7,point:{x:0,y:0}},b:{body:-1,point:{x:0,y:0}},length:50}),s=>s.construction.platforms=[[{x:0,y:0}]],s=>s.width=0]){const s=example();change(s);assert.throws(()=>validateScene(s));}
});
