const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildConfig}=require('../src/config/sqlServer');
const {validateStartup}=require('../src/config/settings');
const bcrypt=require('bcryptjs');

// Configuracao ficticia; nao abre conexoes nem consulta banco.
test('Excecao TI: dispensa certificado SQL sem desligar criptografia',()=>{
  const vars={SQLSERVER_HOST:'sql.example.invalid',SQLSERVER_USER:'test-only',SQLSERVER_PASSWORD:'test-only',SQLSERVER_ENCRYPT:'true',SQLSERVER_AL_DATABASE:'MIX-AL',SQLSERVER_SE_DATABASE:'MIX-SE',SERVICE_CLIENT_ID:'test-only',SERVICE_CLIENT_SECRET:bcrypt.hashSync('test-only',4),JWT_SECRET:'only-for-offline-tests-12345678901234567890'};
  const previous={};
  for(const key of [...Object.keys(vars),'SQLSERVER_TRUST_CERT']) previous[key]=process.env[key];
  try {
    Object.assign(process.env,vars);
    for(const legacy of [undefined,'false','true','legacy-unused-value']) {
      if(legacy===undefined) delete process.env.SQLSERVER_TRUST_CERT;
      else process.env.SQLSERVER_TRUST_CERT=legacy;
      const config=buildConfig();
      assert.equal(config.options.encrypt,true);
      assert.equal(config.options.trustServerCertificate,true);
      assert.doesNotThrow(()=>validateStartup());
    }
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED,'0');
  } finally {
    for(const [key,value] of Object.entries(previous)) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});
