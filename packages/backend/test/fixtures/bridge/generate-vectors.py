"""Regenerate public known answers with Python stdlib and PyNaCl==1.6.2.

This script is independent of the TypeScript implementation and is not a runtime dependency.
"""
import hashlib,hmac,json,base64
from nacl.bindings import crypto_aead_xchacha20poly1305_ietf_encrypt,crypto_scalarmult_base,crypto_scalarmult
from pathlib import Path
enc=lambda b:base64.urlsafe_b64encode(b).decode().rstrip('=')
js=lambda x:json.dumps(x,separators=(',',':'),ensure_ascii=False).encode()
def hkdf(ikm,salt,info):
 prk=hmac.new(salt,ikm,hashlib.sha256).digest()
 return hmac.new(prk,info+b'\x01',hashlib.sha256).digest()
a=bytes(range(32))
keys={label:hkdf(a,b'mains.bridge.v1',('mains.bridge.v1/'+label).encode()) for label in ['body','record','blob-id']}
body={'table':'collections','pk':'known-id'}
rowkey=enc(hmac.new(keys['record'],b'collections:known-id',hashlib.sha256).digest()[:16])
header={'v':1,'stream':'account','rowKey':rowkey,'hlc':{'physicalMs':1700000000000,'counter':7},'origin':'backend-a','op':'delete'}
nonce=bytes(range(24))
aad=js([1,'account',rowkey,None,1700000000000,7,'backend-a','delete',None,None])
payload=crypto_aead_xchacha20poly1305_ietf_encrypt(js(body),aad,nonce,keys['body'])
es=bytes.fromhex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a')
rs=bytes.fromhex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb')
ep,rp=crypto_scalarmult_base(es),crypto_scalarmult_base(rs)
shared=crypto_scalarmult(es,rp)
wk=hkdf(shared,ep+rp,b'mains.bridge.v1/device-wrap')
wn=bytes(range(16,40))
wa=js([1,'mains.bridge.v1/account-key',enc(ep),enc(rp)])
wp=crypto_aead_xchacha20poly1305_ietf_encrypt(a,wa,wn,wk)
result={'provenance':'Generated independently with Python stdlib HKDF/HMAC and PyNaCl 1.6.2 (libsodium XChaCha20-Poly1305/X25519). Device inputs are RFC 7748 section 6.1. These are public test keys.',
 'accountKeyHex':a.hex(),'derivedHex':{k:v.hex() for k,v in keys.items()},
 'delete':{'body':body,'envelope':{'header':header,'body':{'nonce':enc(nonce),'payload':enc(payload)}}},
 'wrap':{'recipientSecretKeyHex':rs.hex(),'recipientPublicKeyHex':rp.hex(),'sealed':{'v':1,'ephemeralPublicKey':enc(ep),'nonce':enc(wn),'payload':enc(wp)}}}
Path(__file__).with_name('crypto-v1.json').write_text(json.dumps(result,indent=2)+'\n')
