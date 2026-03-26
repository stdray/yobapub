plugins {
    id("com.android.application")
}

android {
    namespace = "su.p3o.yobapub"
    compileSdk = 35

    defaultConfig {
        applicationId = "su.p3o.yobapub"
        minSdk = 21
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.leanback:leanback:1.0.0")
}
