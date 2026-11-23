package com.orsted.overlay

import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.view.animation.AlphaAnimation
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.google.android.material.switchmaterial.SwitchMaterial

class SitePickerActivity : AppCompatActivity() {
    
    private lateinit var sharedPrefs: SharedPreferences
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_picker)
        
        sharedPrefs = getSharedPreferences("orsted_prefs", MODE_PRIVATE)
        
        val chessComCard = findViewById<CardView>(R.id.chessComCard)
        val lichessCard = findViewById<CardView>(R.id.lichessCard)
        val desktopModeSwitch = findViewById<SwitchMaterial>(R.id.desktopModeSwitch)
        
        val currentSite = sharedPrefs.getString("selected_site", null)
        val currentMode = sharedPrefs.getString("webview_mode", "mobile")
        
        desktopModeSwitch.isChecked = currentMode == "desktop"
        
        val fadeIn = AlphaAnimation(0f, 1f).apply {
            duration = 500
            fillAfter = true
        }
        
        findViewById<CardView>(R.id.chessComCard).startAnimation(fadeIn)
        findViewById<CardView>(R.id.lichessCard).startAnimation(fadeIn)
        
        // Always show picker to allow users to switch sites or change desktop mode
        // Remove auto-redirect behavior
        // if (currentSite != null) {
        //     val intent = Intent(this, MainActivity::class.java).apply {
        //         putExtra("site", currentSite)
        //     }
        //     startActivity(intent)
        //     finish()
        //     return
        // }
        
        chessComCard.setOnClickListener {
            saveSelection("chess.com", desktopModeSwitch.isChecked)
        }
        
        lichessCard.setOnClickListener {
            saveSelection("lichess.org", desktopModeSwitch.isChecked)
        }
        
        desktopModeSwitch.setOnCheckedChangeListener { _, isChecked ->
            sharedPrefs.edit().putString("webview_mode", if (isChecked) "desktop" else "mobile").apply()
        }
    }
    
    private fun saveSelection(site: String, isDesktop: Boolean) {
        sharedPrefs.edit().apply {
            putString("selected_site", site)
            putString("webview_mode", if (isDesktop) "desktop" else "mobile")
            apply()
        }
        
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra("site", site)
        }
        startActivity(intent)
        finish()
    }
}
