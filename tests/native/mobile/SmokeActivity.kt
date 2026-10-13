package dev.forgesworn.foregather.smoke

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

class SmokeActivity: Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val text = TextView(this)
        text.textSize = 22f
        text.setPadding(32, 64, 32, 32)
        text.text = "Foregather native checks\n\nRunning…"
        setContentView(text)
        Thread {
            val passed = runCatching { main() }.isSuccess
            val result = "{\"passed\":$passed,\"consumer\":\"kotlin\",\"storedAndKithmoot\":$passed,\"wordsAndCharacters\":$passed,\"receipt\":$passed,\"oneUseAndReplay\":$passed}"
            filesDir.resolve("result.json").writeText(result)
            runOnUiThread {
                text.text = if (passed)
                    "Foregather native checks passed\n\nStored recovery\nCaller validation\nWords and characters\nPublic pairing links\nEncrypted invitation and receipt\nReplay and consumed-state rejection\n\nRunning in Android Emulator"
                else "Foregather native checks failed"
                text.setTextColor(if (passed) 0xff147a36.toInt() else 0xffba1a1a.toInt())
            }
        }.start()
    }
}
