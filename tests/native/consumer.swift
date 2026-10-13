import Foundation

func mustReject(_ action: () throws -> Void) {
    do {try action();fatalError("Expected rejection")} catch {}
}
// Synthetic exact-match validator. Applications supply their pinned Fold parser.
final class FixtureValidator: InvitationValidator, @unchecked Sendable {
    let expected: String
    private let lock = NSLock()
    private var counter = 0
    var calls:Int {lock.lock();defer {lock.unlock()};return counter}
    init(_ expected: String) {self.expected = expected}
    func validate(invitation: String) -> Bool {lock.lock();counter += 1;lock.unlock();return invitation == expected}
}
let now: UInt64 = 1_800_000_000
let payload = Data([0,255,1,128])
let codec = try StoredCodec(namespace:"native.example",baseUrl:"https://example.test/i/",allowLoopbackHttp:false)
let sealed = try codec.seal(id:generateLocator(),payload:payload,expires:now+120,now:now)
let recoveredStored = try codec.open(url:sealed.url,envelopeJson:sealed.envelopeJson,now:now)
precondition(recoveredStored == payload)
mustReject {_ = try codec.open(url:sealed.url,envelopeJson:sealed.envelopeJson,now:now+120)}
let fixture = "https://kithmoot.app/j/#eyJ2IjoyLCJqIjoic3ludGhldGljIiwiaCI6InN5bnRoZXRpYyJ9"
let validator = FixtureValidator(fixture)
let kithmoot = try KithmootCodec(validator:validator)
let wrapped = try kithmoot.seal(id:generateLocator(),invitation:fixture,expires:now+120,now:now)
let recoveredKithmoot = try kithmoot.open(url:wrapped.url,envelopeJson:wrapped.envelopeJson,now:now)
precondition(recoveredKithmoot == fixture)
precondition(validator.calls == 2)
mustReject {_ = try kithmoot.seal(id:generateLocator(),invitation:"invalid",expires:now+120,now:now)}
var secret = Data(repeating:0,count:32);secret[31] = 1
let spoken = try deriveSpokenWords(secret:secret,context:"test",counter:0,identity:nil,count:3)
precondition(spoken == "jazz earth glacier")
for format in [AccessFormat.words,AccessFormat.characters] {
    let offer = try createLiveOffer(namespace:"native.example",purpose:"invitation",format:format,count:format == .words ? 4 : 6,lifetime:120,now:now)
    let publicPairing = PublicPairing(sessionJson:offer.sessionJson,format:format)
    let link = try createPublicPairingLink(baseUrl:"https://example.test/pair/",pairing:publicPairing,allowLoopbackHttp:false,namespace:"native.example",purpose:"invitation",now:now)
    precondition(!link.contains(offer.secret))
    let parsed = try parsePublicPairingLink(url:link,baseUrl:"https://example.test/pair/",allowLoopbackHttp:false,namespace:"native.example",purpose:"invitation",now:now)
    precondition(parsed.sessionJson == offer.sessionJson)
    mustReject {_ = try parsePublicPairingLink(url:link,baseUrl:"https://other.test/pair/",allowLoopbackHttp:false,namespace:"native.example",purpose:"invitation",now:now)}
    let a = try PairingGate(offer:offer,namespace:"native.example",purpose:"invitation",role:.inviter,now:now)
    let b = try PairingGate(offer:offer,namespace:"native.example",purpose:"invitation",role:.recipient,now:now)
    let ax = try a.start(now:now), bx = try b.start(now:now)
    let ah = try ax.hello(), bh = try bx.hello()
    let ap = try ax.finish(peerHello:bh,now:now), bp = try bx.finish(peerHello:ah,now:now)
    mustReject {_ = try ax.hello()};mustReject {_ = try a.start(now:now)}
    let aproof = try ap.proof(), bproof = try bp.proof()
    let ac = try ap.confirm(peerProof:bproof,now:now), bc = try bp.confirm(peerProof:aproof,now:now)
    let aw = try ac.verificationWords(count:3,now:now), bw = try bc.verificationWords(count:3,now:now)
    precondition(aw == bw)
    let frame = try createInvitationTransfer(payload:payload)
    let packet = try ac.seal(payload:frame,now:now)
    let opened = try bc.open(packet:packet,now:now)
    let recoveredPayload = try invitationTransferPayload(frame:opened)
    precondition(recoveredPayload == payload)
    mustReject {_ = try bc.open(packet:packet,now:now)}
    let receipt = try invitationTransferReceipt(frame:opened)
    let reply = try bc.seal(payload:receipt,now:now)
    try invitationTransferAcknowledged(frame:frame,receipt:ac.open(packet:reply,now:now))
    var altered = receipt;altered[51] ^= 1
    mustReject {try invitationTransferAcknowledged(frame:frame,receipt:altered)}
    try a.dispose();try b.dispose();try ac.dispose();try bc.dispose()
    mustReject {_ = try ac.verificationWords(count:3,now:now)}
}
print("{\"passed\":true,\"consumer\":\"swift\",\"storedAndKithmoot\":true,\"wordsAndCharacters\":true,\"receipt\":true,\"oneUseAndReplay\":true}")
