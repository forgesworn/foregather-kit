import dev.forgesworn.foregather.*

// Synthetic exact-match validator. Applications supply their pinned Fold parser.
class FixtureValidator(private val expected:String):InvitationValidator {
    var calls = 0
    override fun validate(invitation:String):Boolean {calls++;return invitation == expected}
}
fun main() {
    val now = 1_800_000_000uL
    val payload = byteArrayOf(0,-1,1,-128)
    val codec = StoredCodec("native.example","https://example.test/i/",false)
    val sealed = codec.seal(generateLocator(),payload,now+120uL,now)
    check(codec.open(sealed.url,sealed.envelopeJson,now).contentEquals(payload))
    check(runCatching {codec.open(sealed.url,sealed.envelopeJson,now+120uL)}.isFailure)
    val fixture = "https://kithmoot.app/j/#eyJ2IjoyLCJqIjoic3ludGhldGljIiwiaCI6InN5bnRoZXRpYyJ9"
    val validator = FixtureValidator(fixture)
    val kithmoot = KithmootCodec(validator)
    val wrapped = kithmoot.seal(generateLocator(),fixture,now+120uL,now)
    check(kithmoot.open(wrapped.url,wrapped.envelopeJson,now) == fixture)
    check(validator.calls == 2)
    check(runCatching {kithmoot.seal(generateLocator(),"invalid",now+120uL,now)}.isFailure)
    val secret = ByteArray(32);secret[31] = 1
    check(deriveSpokenWords(secret,"test",0u,null,3u) == "jazz earth glacier")
    for(format in listOf(AccessFormat.WORDS,AccessFormat.CHARACTERS)) {
        val offer = createLiveOffer("native.example","invitation",format,if(format == AccessFormat.WORDS)4u else 6u,120uL,now)
        val publicPairing = PublicPairing(offer.sessionJson,format)
        val link = createPublicPairingLink("https://example.test/pair/",publicPairing,false,"native.example","invitation",now)
        check(!link.contains(offer.secret))
        val parsed = parsePublicPairingLink(link,"https://example.test/pair/",false,"native.example","invitation",now)
        check(parsed.sessionJson == offer.sessionJson)
        check(runCatching {parsePublicPairingLink(link,"https://other.test/pair/",false,"native.example","invitation",now)}.isFailure)
        val a = PairingGate(offer,"native.example","invitation",PairingRole.INVITER,now)
        val b = PairingGate(offer,"native.example","invitation",PairingRole.RECIPIENT,now)
        val ax = a.start(now);val bx = b.start(now);val ah = ax.hello();val bh = bx.hello()
        val ap = ax.finish(bh,now);val bp = bx.finish(ah,now)
        check(runCatching {ax.hello()}.isFailure);check(runCatching {a.start(now)}.isFailure)
        val aproof = ap.proof();val bproof = bp.proof()
        val ac = ap.confirm(bproof,now);val bc = bp.confirm(aproof,now)
        check(ac.verificationWords(3u,now) == bc.verificationWords(3u,now))
        val frame = createInvitationTransfer(payload);val packet = ac.seal(frame,now);val opened = bc.open(packet,now)
        check(invitationTransferPayload(opened).contentEquals(payload));check(runCatching {bc.open(packet,now)}.isFailure)
        val receipt = invitationTransferReceipt(opened);val reply = bc.seal(receipt,now)
        invitationTransferAcknowledged(frame,ac.open(reply,now))
        val altered = receipt.copyOf();altered[51] = (altered[51].toInt() xor 1).toByte()
        check(runCatching {invitationTransferAcknowledged(frame,altered)}.isFailure)
        a.dispose();b.dispose();ac.dispose();bc.dispose()
        check(runCatching {ac.verificationWords(3u,now)}.isFailure)
        a.close();b.close();ax.close();bx.close();ap.close();bp.close();ac.close();bc.close()
    }
    codec.close();kithmoot.close()
    println("{\"passed\":true,\"consumer\":\"kotlin\",\"storedAndKithmoot\":true,\"wordsAndCharacters\":true,\"receipt\":true,\"oneUseAndReplay\":true}")
}
