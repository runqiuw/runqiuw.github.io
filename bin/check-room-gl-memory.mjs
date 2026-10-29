// Exercise the allocation ledger without a GPU; browser runs validate integration separately.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class GL {
  constructor(){this.canvas={classList:{contains:()=>true},width:10,height:10};this.bindings={};}
  activeTexture(){} bindTexture(){} deleteTexture(){} texStorage2D(){} texStorage3D(){} texImage2D(){} texImage3D(){} compressedTexImage2D(){} compressedTexImage3D(){} generateMipmap(){}
  bindBuffer(target,buffer){this.bindings[target]=buffer;} deleteBuffer(){} bufferData(){}
  bindRenderbuffer(){} deleteRenderbuffer(){} renderbufferStorage(){} renderbufferStorageMultisample(){}
  getParameter(binding){if(binding===this.DRAW_FRAMEBUFFER_BINDING)return this.testFramebuffer??null;if(binding===this.SAMPLES)return 4;return this.bindings[binding];} getContextAttributes(){return {depth:true,stencil:true,antialias:true};} isContextLost(){return false;}
}
Object.assign(GL.prototype,{
  TEXTURE0:0x84c0,TEXTURE_2D:0x0de1,TEXTURE_CUBE_MAP:0x8513,TEXTURE_CUBE_MAP_POSITIVE_X:0x8515,TEXTURE_CUBE_MAP_NEGATIVE_Z:0x851a,TEXTURE_3D:0x806f,
  ARRAY_BUFFER:0x8892,ARRAY_BUFFER_BINDING:0x8892,ELEMENT_ARRAY_BUFFER:0x8893,ELEMENT_ARRAY_BUFFER_BINDING:0x8893,
  RGBA:0x1908,UNSIGNED_BYTE:0x1401,RENDERBUFFER:0x8d41,DRAW_FRAMEBUFFER_BINDING:0x8ca6,SAMPLES:0x80a9,
});
const window={},context=vm.createContext({window,WebGL2RenderingContext:GL});
vm.runInContext(readFileSync(new URL('./room-gl-memory.js',import.meta.url),'utf8'),context);
const gl=new GL(),texture={},cube={},buffer={},rb={};
gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,3,0x8058,4,4);
assert.equal(window.__roomMemory()[0].textureBytes,84,'4×4 RGBA8 mip chain');
gl.bindTexture(gl.TEXTURE_CUBE_MAP,cube);gl.texStorage2D(gl.TEXTURE_CUBE_MAP,3,0x8058,4,4);
assert.equal(window.__roomMemory()[0].textureBytes,588,'six cube faces');
gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(32),0);
gl.bindRenderbuffer(gl.RENDERBUFFER,rb);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,4,0x88f0,8,8);
let sample=window.__roomMemory()[0];assert.equal(sample.bufferBytes,32);assert.equal(sample.renderbufferBytes,1024);assert.equal(sample.canvasSingleSampleBytes,800);assert.equal(sample.canvasSamples,4);assert.equal(sample.canvasMsaaEstimateBytes,3600);assert.equal(sample.roomEstimateBytes,588+32+1024+3600);
gl.testFramebuffer={};assert.equal(window.__roomMemory()[0].canvasMsaaEstimateBytes,null,'do not use offscreen SAMPLES for the default canvas');gl.testFramebuffer=null;
gl.bufferData(gl.ARRAY_BUFFER,new Int16Array(8),0,2,3);assert.equal(window.__roomMemory()[0].bufferBytes,6,'typed array subrange');
gl.bufferData(gl.ARRAY_BUFFER,16,0);gl.deleteTexture(cube);gl.deleteRenderbuffer(rb);gl.deleteBuffer(buffer);
sample=window.__roomMemory()[0];assert.equal(sample.textureBytes,84);assert.equal(sample.bufferBytes,0);assert.equal(sample.renderbufferBytes,0);
gl.texStorage2D(gl.TEXTURE_2D,1,0xdead,4,4);assert(window.__roomMemory()[0].unknownAllocations>0,'unknown formats are reported');
gl.isContextLost=()=>true;assert.equal(window.__roomMemory().length,0,'lost contexts are excluded');
console.log('PASS: texture mipmaps/cube faces, buffer resize/deletion, MSAA renderbuffers, canvas estimate and unknown formats');
