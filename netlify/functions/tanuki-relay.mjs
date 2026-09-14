import { getStore } from '@netlify/blobs';
import { createServerlessBridge } from '../../tools/TanukiChatGPTBridge/serverless-bridge.mjs';

let handler=null;
export default async (request,context) => {
  if (!handler) handler=createServerlessBridge({stateStore:getStore('tanuki-site-relay')});
  return handler(request,context);
};

export const config={
  path:[
    '/healthz','/readyz','/mcp',
    '/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp','/.well-known/oauth-authorization-server',
    '/oauth/*','/pair/*','/v1/*'
  ],
  rateLimit:{windowLimit:240,windowSize:60,aggregateBy:['ip','domain']},
};
