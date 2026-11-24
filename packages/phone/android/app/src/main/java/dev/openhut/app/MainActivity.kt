package dev.openhut.app

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(DeviceKeyPlugin::class.java)
        registerPlugin(LockedWebViewPlugin::class.java)
        super.onCreate(savedInstanceState)
        // R6: start from the last pack the native updater installed, else the built-in one, then poll for the next.
        PackUpdater.installed(this)?.let { bridge.setServerBasePath(it.path) }
        val settings = PackUpdater.settings(intent)
        Thread {
            val line = PackUpdater.poll(this, settings)
            android.util.Log.i("OpenHut", "Pack update: $line")
            runOnUiThread {
                if (line.startsWith("installed")) PackUpdater.installed(this)?.let { bridge.setServerBasePath(it.path) }
                if (BuildConfig.DEBUG) addContentView(TextView(this).apply {
                    text = "Native shell updater (sequence ${PackUpdater.state(this@MainActivity)?.sequence ?: -1}): $line"
                    setBackgroundColor(Color.argb(204, 0, 0, 0))
                    setTextColor(Color.WHITE)
                    typeface = android.graphics.Typeface.MONOSPACE
                    setPadding(24, 24, 24, 24)
                }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply { bottomMargin = 120 })
            }
        }.start()
    }
}
