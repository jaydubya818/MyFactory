/** Bound the complete input read, including a body which never yields bytes. */
export async function receiverJson(request,limit=65536,timeoutMs=5000){
 if(!request.body)throw Error('RECEIVER_BODY_MISSING');
 const reader=request.body.getReader(),chunks=[];let length=0,timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(Error('RECEIVER_BODY_TIMEOUT'));},timeoutMs);});
 try{
  return await Promise.race([deadline,(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit)throw Error('RECEIVER_BODY_BOUND');chunks.push(Buffer.from(value));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));})()]);
 }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
