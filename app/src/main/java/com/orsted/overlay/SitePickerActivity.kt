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
    
    companion object {
        const val PREFS_NAME = "orsted_prefs"
        const val KEY_DESKTOP = "desktop_mode"
        const val KEY_START_URL = "start_url"
    }
    
    private lateinit var sharedPrefs: SharedPreferences
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_picker)
        
        sharedPrefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        
        val chessComCard = findViewById<CardView>(R.id.chessComCard)
        val lichessCard = findViewById<CardView>(R.id.lichessCard)
        val desktopModeSwitch = findViewById<SwitchMaterial>(R.id.desktopModeSwitch)
        
        val currentSite = sharedPrefs.getString("selected_site", null)
        val currentDesktop = sharedPrefs.getBoolean(KEY_DESKTOP, false)
        
        desktopModeSwitch.isChecked = currentDesktop
        
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
            sharedPrefs.edit().putBoolean(KEY_DESKTOP, isChecked).apply()
        }
    }
    
    private fun saveSelection(site: String, isDesktop: Boolean) {
        sharedPrefs.edit().apply {
            putString("selected_site", site)
            putBoolean(KEY_DESKTOP, isDesktop)
            putString(KEY_START_URL, if (site == "chess.com") "https://www.chess.com" else "https://lichess.org")
            apply()
        }
        
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra("site", site)
        }
        startActivity(intent)
        finish()
    }
}
