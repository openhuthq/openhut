package dev.openhut.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(DeviceKeyPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
