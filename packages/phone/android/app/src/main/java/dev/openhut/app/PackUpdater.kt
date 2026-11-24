package dev.openhut.app

import android.content.Context
import android.content.Intent
import android.util.Base64
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.zip.GZIPInputStream

// R6: the Android twin of ios/App/App/PackUpdater.swift. The pack updater lives in the native shell, never in the app pack it installs:
// it polls the R4 feed, checks the release key's Ed25519 signature, the Rekor entry and the SEC6 hour (verifyRelease and pointerAction
// in packages/desktop/src/release-key.mjs), then installs release.packs.app's renderer/ as the web root. No plugin exposes it to
// JavaScript and its state is a file no plugin writes, so a pack can't switch the check off for the updates after it.
object PackUpdater {
    const val SHELL_API = 1
    const val MIN_AGE = 3600L
    const val RELEASE_KEY = "MCowBQYDK2VwAyEAQbo1L199M6phAczpCAlP6iQc0+AMcbpjrnqH1XvCUyk="
    const val REKOR_KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2G2Y+2tabdTV5BcGiBIx0a9fAFwrkBbmLSGtks4L3qX6yYY0zufBnhC8Ur/iy55GhWP/9A/bY2LhC30M9+RYtw=="
    const val FEED = "https://dl.openhut.dev"
    const val CHANNEL = "stable"

    data class Settings(val feed: String, val channel: String, val releaseKey: ByteArray, val rekorKey: ByteArray)

    // Debug builds take a test feed and test keys from the launch intent (adb shell am start -e OPENHUT_FEED ...). A pack can't set
    // either; release builds ignore them.
    fun settings(intent: Intent?): Settings {
        val extra = { name: String -> if (BuildConfig.DEBUG) intent?.getStringExtra(name) else null }
        return Settings(extra("OPENHUT_FEED") ?: FEED, extra("OPENHUT_CHANNEL") ?: CHANNEL,
            b64(extra("OPENHUT_RELEASE_KEY") ?: RELEASE_KEY), b64(extra("OPENHUT_REKOR_KEY") ?: REKOR_KEY))
    }

    fun root(context: Context) = File(context.noBackupFilesDir, "openhut-packs")
    data class State(val sequence: Long, val path: String, val version: String)

    fun state(context: Context): State? = try {
        val json = JSONObject(File(root(context), "state.json").readText())
        State(json.getLong("sequence"), json.getString("path"), json.getString("version"))
    } catch (_: Exception) { null }

    // The installed pack's web root, if one is installed and still on disk.
    fun installed(context: Context): File? {
        val dir = File(root(context), state(context)?.path ?: return null)
        return if (File(dir, "index.html").exists()) dir else null
    }

    sealed class Action {
        data class Refuse(val reason: String) : Action()
        object None : Action()
        object Halt : Action()
        data class Wait(val retryAt: Long) : Action()
        data class Install(val sequence: Long, val version: String, val sha512: String) : Action()
    }

    // pointerAction() from release-key.mjs.
    fun action(manifest: ByteArray, signature: String, rekor: ByteArray, installed: Long, settings: Settings, now: Long = System.currentTimeMillis() / 1000): Action {
        val (reason, retryAt) = verifyRelease(manifest, signature, rekor, settings.releaseKey, settings.rekorKey, now)
        if (reason != null && retryAt == null) return Action.Refuse(reason)
        val release = try { JSONObject(String(manifest)) } catch (_: Exception) { return Action.Refuse("malformed release") }
        val channel = release.optString("channel")
        if (channel != settings.channel) return Action.Refuse("a $channel release on the ${settings.channel} channel")
        val sequence = release.optLong("sequence", -1)
        if (sequence <= installed) return Action.None
        if (release.optBoolean("halt")) return Action.Halt
        val api = release.optJSONObject("shellApi")
        if (api == null || api.optInt("min", Int.MAX_VALUE) > SHELL_API || SHELL_API > api.optInt("max", -1)) return Action.Refuse("needs another shell")
        if (retryAt != null) return Action.Wait(retryAt)
        val sha512 = release.optJSONObject("packs")?.optJSONObject("app")?.optString("sha512") ?: return Action.Refuse("no app pack")
        return Action.Install(sequence, release.optString("version"), sha512)
    }

    // verifyRelease() from release-key.mjs: (null, null) when it holds, else (reason, retryAt when only the hour is missing).
    fun verifyRelease(manifest: ByteArray, signature: String, rekor: ByteArray, key: ByteArray, rekorKey: ByteArray, now: Long): Pair<String?, Long?> {
        val sig = try { b64(signature.trim()) } catch (_: Exception) { return "not signed by the release key" to null }
        if (!ed25519(key, manifest, sig)) return "not signed by the release key" to null
        val entry = try { JSONObject(String(rekor)).let { it.getJSONObject(it.keys().next()) } } catch (_: Exception) { return "no Rekor entry" to null }
        val integratedTime = rekorIncluded(entry, rekorKey) ?: return "the Rekor entry has no valid timestamp or inclusion proof" to null
        val logged = try {
            val body = JSONObject(String(b64(entry.getString("body"))))
            val spec = body.getJSONObject("spec")
            val hash = spec.getJSONObject("data").getJSONObject("hash")
            val signed = spec.getJSONObject("signature")
            val pem = String(b64(signed.getJSONObject("publicKey").getString("content")))
            body.getString("kind") == "rekord" && hash.getString("algorithm") == "sha256" && hash.getString("value") == hex(digest("SHA-256", manifest)) &&
                b64(signed.getString("content")).contentEquals(sig) &&
                b64(pem.lines().filter { it.isNotBlank() && !it.startsWith("-----") }.joinToString("")).contentEquals(key)
        } catch (_: Exception) { false }
        if (!logged) return "the Rekor entry is for another release" to null
        val retryAt = integratedTime + MIN_AGE
        return if (now >= retryAt) null to null else "logged less than an hour ago" to retryAt
    }

    // rekorIncluded() from release-key.mjs: integratedTime when Rekor signed both the SET and a checkpoint whose tree holds the entry.
    fun rekorIncluded(entry: JSONObject, rekorKey: ByteArray): Long? = try {
        val body = entry.getString("body")
        val integratedTime = entry.getLong("integratedTime")
        val verification = entry.getJSONObject("verification")
        val proof = verification.getJSONObject("inclusionProof")
        // JSON.stringify({ body, integratedTime, logID, logIndex }); body and logID are base64 and hex, so nothing needs escaping.
        val canonical = "{\"body\":\"$body\",\"integratedTime\":$integratedTime,\"logID\":\"${entry.getString("logID")}\",\"logIndex\":${entry.getLong("logIndex")}}"
        val treeSize = proof.getLong("treeSize")
        val rootHash = proof.getString("rootHash")
        val parts = proof.getString("checkpoint").split("\n\n")
        val note = parts[0]
        val lines = note.split("\n")
        val signedNote = parts[1].split("\n").any { line ->
            line.startsWith("— ") && try { verify("EC", "SHA256withECDSA", rekorKey, "$note\n".toByteArray(), b64(line.split(" ").last()).drop(4).toByteArray()) } catch (_: Exception) { false }
        }
        val hashes = proof.getJSONArray("hashes").let { a -> List(a.length()) { a.getString(it) } }
        val leaf = digest("SHA-256", byteArrayOf(0) + b64(body))
        if (verify("EC", "SHA256withECDSA", rekorKey, canonical.toByteArray(), b64(verification.getString("signedEntryTimestamp"))) &&
            lines[1] == treeSize.toString() && hex(b64(lines[2])) == rootHash && signedNote &&
            rootFrom(proof.getLong("logIndex"), treeSize, leaf, hashes)?.let(::hex) == rootHash) integratedTime else null
    } catch (_: Exception) { null }

    // RFC 9162 §2.1.3.2, as rootFrom() in release-key.mjs.
    fun rootFrom(index: Long, size: Long, leaf: ByteArray, hashes: List<String>): ByteArray? {
        var fn = index
        var sn = size - 1
        if (index < 0 || fn > sn) return null
        var r = leaf
        for (h in hashes) {
            val p = unhex(h)
            if (sn == 0L) return null
            if (fn and 1L == 1L || fn == sn) {
                r = digest("SHA-256", byteArrayOf(1) + p + r)
                while (fn and 1L == 0L && fn != 0L) { fn = fn shr 1; sn = sn shr 1 }
            } else r = digest("SHA-256", byteArrayOf(1) + r + p)
            fn = fn shr 1; sn = sn shr 1
        }
        return if (sn == 0L) r else null
    }

    // One poll: fetch the channel pointer, decide, and install the app pack when the decision is install. Returns a line for the log.
    fun poll(context: Context, settings: Settings): String = try {
        val channel = "${settings.feed}/channels/${settings.channel}/release.json"
        val manifest = fetch(channel)
        val signature = String(fetch("$channel.sig"))
        val rekor = try { fetch("$channel.rekor") } catch (_: Exception) { ByteArray(0) }
        when (val action = action(manifest, signature, rekor, state(context)?.sequence ?: -1, settings)) {
            is Action.Refuse -> "refused: ${action.reason}"
            Action.None -> "up to date (sequence ${state(context)?.sequence ?: -1})"
            Action.Halt -> "halted"
            is Action.Wait -> "refused for now: logged less than an hour ago, retry after ${java.time.Instant.ofEpochSecond(action.retryAt)}"
            is Action.Install -> {
                val want = b64(action.sha512)
                val pack = fetch("${settings.feed}/packs/${hex(want)}")
                if (!digest("SHA-512", pack).contentEquals(want)) "refused: the app pack doesn't match release.json"
                else {
                    val dir = File(root(context), action.sequence.toString())
                    dir.deleteRecursively()
                    untar(GZIPInputStream(ByteArrayInputStream(pack)).readBytes(), "renderer/", dir)
                    File(root(context), "state.json").writeText(JSONObject().put("sequence", action.sequence).put("path", dir.name).put("version", action.version).toString())
                    "installed ${action.version} (sequence ${action.sequence})"
                }
            }
        }
    } catch (e: Exception) { "refused: $e" }

    private fun fetch(url: String): ByteArray {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            if (connection.responseCode != 200) throw IllegalStateException("$url: ${connection.responseCode}")
            return connection.inputStream.readBytes()
        } finally { connection.disconnect() }
    }

    // The files under `prefix` in a ustar/PAX archive (as scripts/pack.ts writes), written below `into` without the prefix.
    fun untar(tar: ByteArray, prefix: String, into: File) {
        var at = 0
        var longName: String? = null
        val field = { from: Int, length: Int -> String(tar, from, length).substringBefore('\u0000') }
        while (at + 512 <= tar.size && tar[at] != 0.toByte()) {
            val size = field(at + 124, 12).trim().toInt(8)
            val type = tar[at + 156].toInt().toChar()
            val start = at + 512
            require(start + size <= tar.size)
            val name = longName ?: field(at, 100)
            longName = null
            if (type == 'x') {
                String(tar, start, size).lines().firstOrNull { it.contains(" path=") }?.let { longName = it.substringAfter("=") }
            } else if ((type == '0' || type == '\u0000') && name.startsWith(prefix)) {
                val path = name.removePrefix(prefix)
                require(".." !in path.split("/"))
                val file = File(into, path)
                file.parentFile?.mkdirs()
                file.writeBytes(tar.copyOfRange(start, start + size))
            }
            at = start + (size + 511) / 512 * 512
        }
    }

    private fun verify(keyType: String, algorithm: String, spki: ByteArray, data: ByteArray, signature: ByteArray) = try {
        Signature.getInstance(algorithm).run {
            initVerify(KeyFactory.getInstance(keyType).generatePublic(X509EncodedKeySpec(spki)))
            update(data)
            verify(signature)
        }
    } catch (_: Exception) { false }

    // The release key is an Ed25519 SPKI: a fixed 12-byte prefix, then the 32-byte key.
    private val ED25519_SPKI = unhex("302a300506032b6570032100")
    private fun ed25519(spki: ByteArray, data: ByteArray, signature: ByteArray) = try {
        spki.size == 44 && spki.copyOfRange(0, 12).contentEquals(ED25519_SPKI) && Ed25519Signer().run {
            init(false, Ed25519PublicKeyParameters(spki, 12))
            update(data, 0, data.size)
            verifySignature(signature)
        }
    } catch (_: Exception) { false }

    private fun digest(algorithm: String, data: ByteArray) = MessageDigest.getInstance(algorithm).digest(data)
    private fun b64(text: String) = Base64.decode(text, Base64.DEFAULT)
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
    private fun unhex(text: String) = ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}
