package dev.openhut.app

import android.hardware.biometrics.BiometricManager.Authenticators
import android.hardware.biometrics.BiometricPrompt
import android.os.CancellationSignal
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.KeyAgreement

@CapacitorPlugin(name = "DeviceKey")
class DeviceKeyPlugin : Plugin() {
    private val alias = "openhut-device-key"
    private val spkiPrefix = unhex("302a300506032b656e032100")

    private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun entry() = store().getEntry(alias, null) as? KeyStore.PrivateKeyEntry

    private fun create(): KeyStore.PrivateKeyEntry {
        val generator = KeyPairGenerator.getInstance("XDH", "AndroidKeyStore")
        generator.initialize(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_AGREE_KEY)
                .setAlgorithmParameterSpec(ECGenParameterSpec("x25519"))
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(300, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                .build()
        )
        generator.generateKeyPair()
        return entry() ?: throw IllegalStateException("The device key was not saved.")
    }

    private fun securityLevel(key: PrivateKey): String {
        val info = KeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java)
        return when (info.securityLevel) {
            KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
            KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "trusted-environment"
            KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE -> "unknown-secure"
            KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
            else -> "unknown"
        }
    }

    @PluginMethod
    fun publicKey(call: PluginCall) {
        try {
            val key = entry() ?: create()
            val raw = key.certificate.publicKey.encoded.takeLast(32).toByteArray()
            call.resolve(JSObject().put("publicKey", hex(raw)).put("securityLevel", securityLevel(key.privateKey)))
        } catch (e: Exception) {
            call.reject("Couldn't make the device key: ${e.message}")
        }
    }

    @PluginMethod
    fun agree(call: PluginCall) {
        val remote = call.getString("publicKey")?.takeIf { Regex("^[0-9a-f]{64}$").matches(it) }
            ?: return call.reject("publicKey must be 64 lowercase hex characters.")
        val key = entry() ?: return call.reject("There is no device key yet.")
        try {
            call.resolve(secret(key.privateKey, remote))
        } catch (e: UserNotAuthenticatedException) {
            unlock(call) { call.resolve(secret(key.privateKey, remote)) }
        } catch (e: Exception) {
            call.reject("Couldn't agree on a secret: ${e.message}")
        }
    }

    @PluginMethod
    fun wipe(call: PluginCall) {
        store().deleteEntry(alias)
        call.resolve()
    }

    private fun secret(key: PrivateKey, remote: String): JSObject {
        val other = KeyFactory.getInstance("XDH").generatePublic(X509EncodedKeySpec(spkiPrefix + unhex(remote)))
        val agreement = KeyAgreement.getInstance("XDH", "AndroidKeyStore")
        agreement.init(key)
        agreement.doPhase(other, true)
        return JSObject().put("secret", hex(agreement.generateSecret()))
    }

    private fun unlock(call: PluginCall, then: () -> Unit) {
        val prompt = BiometricPrompt.Builder(context)
            .setTitle("Unlock OpenHut")
            .setAllowedAuthenticators(Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL)
            .build()
        activity.runOnUiThread {
            prompt.authenticate(CancellationSignal(), context.mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    try {
                        then()
                    } catch (e: Exception) {
                        call.reject("Couldn't agree on a secret: ${e.message}")
                    }
                }

                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    call.reject("Unlock didn't finish: $message")
                }
            })
        }
    }

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    private fun unhex(text: String) = text.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
