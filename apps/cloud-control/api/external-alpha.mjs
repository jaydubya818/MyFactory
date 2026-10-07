import {handleExternalAlpha} from '../src/external-alpha-control.mjs';
export default {fetch:request=>handleExternalAlpha(request,process.env)};
