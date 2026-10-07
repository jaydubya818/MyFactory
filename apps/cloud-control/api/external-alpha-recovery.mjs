import {handleExternalAlphaRecovery} from '../src/external-alpha-recovery.mjs';
export default {fetch:request=>handleExternalAlphaRecovery(request,process.env)};
