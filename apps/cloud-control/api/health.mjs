export default { fetch() { return Response.json({ service: 'myfactory', alive: true, ready: false, admission: 'DISABLED' }, { headers: { 'cache-control': 'no-store' } }); } };
