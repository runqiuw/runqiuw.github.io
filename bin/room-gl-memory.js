// Injected before the room creates WebGL. Counts logical WebGL allocations, not physical VRAM.
// Keep the ledger independent of Three.js and never poll GL on each draw.
(() => {
  const proto = WebGL2RenderingContext.prototype, contexts = new Map();
  const states = gl => {
    let s = contexts.get(gl);
    if (!s) {
      s = { unit: gl.TEXTURE0, textures: new Map(), buffers: new Map(), renderbuffers: new Map(), boundTextures: new Map(), boundBuffers: new Map(), rb: null, unknown: 0 };
      contexts.set(gl, s);
    }
    return s;
  };
  const wrap = (name, before) => {
    const original = proto[name];
    if (!original) return;
    proto[name] = function(...args) {
      const result = original.apply(this, args);
      before(this, states(this), args, result);
      return result;
    };
  };
  // Formats are logical bytes per texel; driver padding and hardware compression are unknowable here.
  const bytes = new Map([
    [0x8229,1],[0x822b,2],[0x8051,3],[0x8c41,3],[0x8058,4],[0x8c43,4], // R8, RG8, RGB8, sRGB8, RGBA8, sRGBA8
    [0x822d,2],[0x822f,4],[0x881b,6],[0x881a,8], // R/RG/RGB/RGBA 16F
    [0x822e,4],[0x8230,8],[0x8815,12],[0x8814,16], // 32F
    [0x81a5,2],[0x81a6,4],[0x8cac,4],[0x88f0,4],[0x8cad,8], // depth and depth/stencil
    [0x8056,2],[0x8057,2],[0x8d62,2],[0x8d48,1], // RGBA4, RGB5_A1, RGB565, stencil8
    [0x8c3a,4],[0x8c3d,4],[0x8059,4], // packed HDR and RGB10_A2
  ]);
  const bpp = (gl, internal, format, type) => {
    if (bytes.has(internal)) return bytes.get(internal);
    const components = new Map([[gl.RED,1],[gl.RG,2],[gl.RGB,3],[gl.RGBA,4],[gl.ALPHA,1],[gl.LUMINANCE,1],[gl.LUMINANCE_ALPHA,2],[gl.DEPTH_COMPONENT,1]]).get(format);
    const per = new Map([[gl.UNSIGNED_BYTE,1],[gl.BYTE,1],[gl.UNSIGNED_SHORT,2],[gl.SHORT,2],[gl.HALF_FLOAT,2],[gl.FLOAT,4],[gl.UNSIGNED_INT,4],[gl.INT,4]]).get(type);
    if ([gl.UNSIGNED_SHORT_5_6_5, gl.UNSIGNED_SHORT_4_4_4_4, gl.UNSIGNED_SHORT_5_5_5_1].includes(type)) return 2;
    if ([gl.UNSIGNED_INT_2_10_10_10_REV, gl.UNSIGNED_INT_24_8, gl.UNSIGNED_INT_10F_11F_11F_REV, gl.UNSIGNED_INT_5_9_9_9_REV].includes(type)) return 4;
    return components && per ? components * per : null;
  };
  const targetOf = (gl, t) => t >= gl.TEXTURE_CUBE_MAP_POSITIVE_X && t <= gl.TEXTURE_CUBE_MAP_NEGATIVE_Z ? gl.TEXTURE_CUBE_MAP : t;
  const bound = (gl, s, target) => s.boundTextures.get(`${s.unit}:${targetOf(gl,target)}`);
  const setLevel = (s, texture, face, level, size, width, height, depth, pixelBytes) => {
    if (!texture) { s.unknown++; return; }
    let entry=s.textures.get(texture); if(!entry){entry={levels:new Map()};s.textures.set(texture,entry);}
    entry.levels.set(`${face}:${level}`,{size,width,height,depth,pixelBytes});
    if (size === null) s.unknown++;
  };
  wrap('activeTexture', (_gl,s,[unit]) => {s.unit=unit;});
  wrap('bindTexture', (_gl,s,[target,texture]) => {s.boundTextures.set(`${s.unit}:${target}`,texture);});
  wrap('deleteTexture', (_gl,s,[texture]) => {s.textures.delete(texture);});
  wrap('texStorage2D', (gl,s,[target,levels,format,w,h]) => {
    const texture=bound(gl,s,target), pixelBytes=bpp(gl,format,format,gl.UNSIGNED_BYTE), faces=target===gl.TEXTURE_CUBE_MAP?6:1;
    for(let face=0;face<faces;face++)for(let level=0;level<levels;level++){
      const x=Math.max(1,w>>level),y=Math.max(1,h>>level);
      setLevel(s,texture,face,level,pixelBytes===null?null:x*y*pixelBytes,x,y,1,pixelBytes);
    }
  });
  wrap('texStorage3D', (gl,s,[target,levels,format,w,h,d]) => {
    const texture=bound(gl,s,target),pixelBytes=bpp(gl,format,format,gl.UNSIGNED_BYTE);
    for(let level=0;level<levels;level++){
      const x=Math.max(1,w>>level),y=Math.max(1,h>>level),z=target===gl.TEXTURE_3D?Math.max(1,d>>level):d;
      setLevel(s,texture,0,level,pixelBytes===null?null:x*y*z*pixelBytes,x,y,z,pixelBytes);
    }
  });
  wrap('texImage2D', (gl,s,args) => {
    const [target,level,internal]=args, sized=args.length>=9;
    const source=sized?null:args[5], w=sized?args[3]:(source?.videoWidth||source?.naturalWidth||source?.width), h=sized?args[4]:(source?.videoHeight||source?.naturalHeight||source?.height);
    const format=sized?args[6]:args[3],type=sized?args[7]:args[4], pixelBytes=bpp(gl,internal,format,type);
    const face=targetOf(gl,target)===gl.TEXTURE_CUBE_MAP?target-gl.TEXTURE_CUBE_MAP_POSITIVE_X:0;
    setLevel(s,bound(gl,s,target),face,level,w&&h&&pixelBytes!==null?w*h*pixelBytes:null,w,h,1,pixelBytes);
  });
  wrap('texImage3D', (gl,s,[target,level,internal,w,h,d,_border,format,type]) => {
    const pixelBytes=bpp(gl,internal,format,type);
    setLevel(s,bound(gl,s,target),0,level,w&&h&&d&&pixelBytes!==null?w*h*d*pixelBytes:null,w,h,d,pixelBytes);
  });
  wrap('compressedTexImage2D', (gl,s,args) => {
    const [target,level,_format,w,h,_border,data]=args, size=typeof data==='number'?data:data?.byteLength??null;
    const face=targetOf(gl,target)===gl.TEXTURE_CUBE_MAP?target-gl.TEXTURE_CUBE_MAP_POSITIVE_X:0;
    setLevel(s,bound(gl,s,target),face,level,size,w,h,1,null);
  });
  wrap('compressedTexImage3D', (gl,s,args) => {
    const [target,level,_format,w,h,d,_border,data]=args,size=typeof data==='number'?data:data?.byteLength??null;
    setLevel(s,bound(gl,s,target),0,level,size,w,h,d,null);
  });
  wrap('generateMipmap', (gl,s,[target]) => {
    const entry=s.textures.get(bound(gl,s,target));if(!entry){s.unknown++;return;}
    for(const [key,base] of [...entry.levels]){
      const [face,level]=key.split(':').map(Number);if(level!==0)continue;
      if(!base.pixelBytes){s.unknown++;continue;}
      let {width:w,height:h,depth:d}=base;let n=0;
      while(w>1||h>1||(target===gl.TEXTURE_3D&&d>1)){
        w=Math.max(1,w>>1);h=Math.max(1,h>>1);if(target===gl.TEXTURE_3D)d=Math.max(1,d>>1);n++;
        setLevel(s,bound(gl,s,target),face,n,w*h*d*base.pixelBytes,w,h,d,base.pixelBytes);
      }
    }
  });
  wrap('bindBuffer', (_gl,s,[target,buffer]) => {s.boundBuffers.set(target,buffer);});
  wrap('deleteBuffer', (_gl,s,[buffer]) => {s.buffers.delete(buffer);});
  wrap('bufferData', (gl,s,[target,data,_usage,srcOffset=0,length=0]) => {
    // VAOs can change ELEMENT_ARRAY_BUFFER without a bindBuffer call. Query on allocation only.
    const binding=new Map([[gl.ARRAY_BUFFER,gl.ARRAY_BUFFER_BINDING],[gl.ELEMENT_ARRAY_BUFFER,gl.ELEMENT_ARRAY_BUFFER_BINDING],[gl.COPY_READ_BUFFER,gl.COPY_READ_BUFFER_BINDING],[gl.COPY_WRITE_BUFFER,gl.COPY_WRITE_BUFFER_BINDING],[gl.PIXEL_PACK_BUFFER,gl.PIXEL_PACK_BUFFER_BINDING],[gl.PIXEL_UNPACK_BUFFER,gl.PIXEL_UNPACK_BUFFER_BINDING],[gl.UNIFORM_BUFFER,gl.UNIFORM_BUFFER_BINDING],[gl.TRANSFORM_FEEDBACK_BUFFER,gl.TRANSFORM_FEEDBACK_BUFFER_BINDING]]).get(target);
    const buffer=binding===undefined?s.boundBuffers.get(target):gl.getParameter(binding);
    const elementBytes=data?.BYTES_PER_ELEMENT??1,available=data?.byteLength===undefined?null:data.byteLength/elementBytes;
    const size=typeof data==='number'?data:available===null?null:(length||available-srcOffset)*elementBytes;
    if(buffer && size!==null)s.buffers.set(buffer,size);else s.unknown++;
  });
  wrap('bindRenderbuffer', (_gl,s,[_target,rb]) => {s.rb=rb;});
  wrap('deleteRenderbuffer', (_gl,s,[rb]) => {s.renderbuffers.delete(rb);});
  const storeRB=(gl,s,format,w,h,samples)=>{const pixelBytes=bpp(gl,format,format,gl.UNSIGNED_BYTE);if(s.rb)s.renderbuffers.set(s.rb,pixelBytes===null?null:w*h*pixelBytes*Math.max(1,samples));if(pixelBytes===null||!s.rb)s.unknown++;};
  wrap('renderbufferStorage',(gl,s,[_target,format,w,h])=>storeRB(gl,s,format,w,h,1));
  wrap('renderbufferStorageMultisample',(gl,s,[_target,samples,format,w,h])=>storeRB(gl,s,format,w,h,samples));
  window.__roomMemory = () => {
    const results=[];
    for(const [gl,s] of contexts){
      if(!gl.canvas.classList.contains('room-canvas')||gl.isContextLost())continue;
      const textures=[...s.textures.values()].flatMap(x=>[...x.levels.values()]);
      const total = values => values.reduce((sum,v)=>sum+(v??0),0);
      const textureBytes=total(textures.map(x=>x.size)),bufferBytes=total([...s.buffers.values()]),renderbufferBytes=total([...s.renderbuffers.values()]);
      const canvas=gl.canvas,attrs=gl.getContextAttributes();
      // The browser owns its default framebuffer. SAMPLES is valid only when that framebuffer
      // is bound; use a documented color+depth/stencil MSAA plus resolved-color estimate, not VRAM.
      const pixels=canvas.width*canvas.height,depthBytes=attrs?.depth||attrs?.stencil?4:0;
      const canvasSingleSampleBytes=pixels*(4+depthBytes);
      const defaultBound=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)===null;
      const canvasSamples=defaultBound?gl.getParameter(gl.SAMPLES):null;
      const canvasMsaaEstimateBytes=canvasSamples===null?null:canvasSamples>0?pixels*(canvasSamples*(4+depthBytes)+4):canvasSingleSampleBytes;
      const trackedBytes=textureBytes+bufferBytes+renderbufferBytes;
      results.push({textureBytes,bufferBytes,renderbufferBytes,trackedBytes,canvasSingleSampleBytes,canvasSamples,canvasMsaaEstimateBytes,roomEstimateBytes:canvasMsaaEstimateBytes===null?null:trackedBytes+canvasMsaaEstimateBytes,canvasAntialias:!!attrs?.antialias,unknownAllocations:s.unknown,textureCount:s.textures.size,bufferCount:s.buffers.size,renderbufferCount:s.renderbuffers.size,canvasWidth:canvas.width,canvasHeight:canvas.height});
    }
    return results;
  };
})();
