package com.orsted.overlay

import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.view.animation.AlphaAnimation
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
        desktopModeSwitch.isChecked = sharedPrefs.getBoolean(KEY_DESKTOP, false)

        val fadeIn = AlphaAnimation(0f, 1f).apply {
            duration = 500
            fillAfter = true
        }
        chessComCard.startAnimation(fadeIn)
        lichessCard.startAnimation(fadeIn)

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
        val startUrl = if (site == "chess.com") "https://www.chess.com" else "https://lichess.org"
        sharedPrefs.edit().apply {
            putString("selected_site", site)
            putBoolean(KEY_DESKTOP, isDesktop)
            putString(KEY_START_URL, startUrl)
            apply()
        }
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra("site", site)
            putExtra(KEY_DESKTOP, isDesktop)
            putExtra(KEY_START_URL, startUrl)
        }
        startActivity(intent)
        finish()
    }
}
