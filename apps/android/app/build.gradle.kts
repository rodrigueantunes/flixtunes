import org.gradle.api.tasks.testing.Test

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

/**
 * La révision d'empaquetage, la même que celle du paquet NAS.
 *
 * L'application et le paquet ASUSTOR partagent leurs correctifs mais étaient numérotés séparément :
 * l'APK annonçait `0.5.6` quand le NAS annonçait `0.5.6.r20`. Deux numéros différents pour un même
 * jeu de corrections rendent tout diagnostic à distance impossible — on ne peut pas savoir si les
 * deux côtés portent le même correctif.
 *
 * Elle arrive par la même variable que celle exportée au serveur, ou par `-PflixtunesRevision=r20`.
 * Vide, la version reste nue : une construction locale n'invente pas un numéro de révision.
 */
val revisionPaquet: String = (project.findProperty("flixtunesRevision") as String?)
    ?: System.getenv("FLIXTUNES_PACKAGE_REVISION")
    ?: ""
val numeroRevision = Regex("""\d+""").find(revisionPaquet)?.value?.toIntOrNull() ?: 0
val suffixeRevision = if (numeroRevision > 0) ".r$numeroRevision" else ""

/**
 * La version du produit, lue au **manifeste racine** et non écrite ici.
 *
 * Elle y était en dur — « 0.5.6 » à trois endroits — et la première montée de version mineure depuis
 * l'écriture de la chaîne de livraison l'a fait voir : `Sync-Version.ps1` propage la version dans les
 * six manifestes du dépôt, mais pas dans un fichier Gradle. La livraison 0.5.7 produisait donc un APK
 * nommé `0.5.6.r1`, et le script s'arrêtait sur « aucun APK en 0.5.7.r1 » — le défaut se voyait, au
 * moins, plutôt que de sortir un paquet mal nommé.
 *
 * Le `package.json` de la racine est la source unique, comme il l'est déjà pour le serveur, qui lit
 * sa version au démarrage plutôt que de la porter en dur.
 */
val versionProduit: String = run {
    val manifeste = rootProject.file("../../package.json").readText()
    Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(manifeste)?.groupValues?.get(1)
        ?: error("Version introuvable dans package.json : l'APK ne doit pas en inventer une.")
}

/**
 * `versionCode` dérivé de la version, et non d'un nombre écrit à la main.
 *
 * Android exige un entier croissant : 0.5.7.r1 donne 57 001, 0.5.6.r88 donnait 56 088. Une version
 * mineure de plus vaut donc mille révisions, ce qui laisse largement la place et garde l'ordre.
 */
val codeVersion: Int = run {
    val morceaux = versionProduit.split(".").mapNotNull { it.toIntOrNull() }
    val mineur = morceaux.getOrElse(1) { 0 }
    val correctif = morceaux.getOrElse(2) { 0 }
    (mineur * 10 + correctif) * 1_000 + numeroRevision
}

// Le fichier produit porte le même numéro que ce que l'application affichera : c'est ce qu'on lit sur
// un téléphone quand on cherche à savoir ce qui y est installé.
base { archivesName.set("FlixTunes-Android-$versionProduit$suffixeRevision") }

android {
    namespace = "tv.flixtunes.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "tv.flixtunes.app"
        minSdk = 23
        targetSdk = 36
        // Une révision doit aussi avancer versionCode, sinon Android refuse la mise à jour ou ne
        // permet pas de distinguer deux APK qui affichent pourtant des numéros différents.
        versionCode = codeVersion
        versionName = "$versionProduit$suffixeRevision"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            // AAPT2 recompresse chaque PNG, et chaque passage est un aller-retour de fichier. Sur un
            // dépôt hébergé sur un partage réseau, ces allers-retours dépassent le délai de trente
            // secondes du démon, qui abandonne : la construction échoue sur trois images de 9 à 81 Ko.
            //
            // Ces images viennent de tools/New-BrandAssets.ps1, déjà produites à la bonne taille : les
            // recompresser ne gagne que quelques kilo-octets, pour un coût qui rend la construction
            // impossible. Le gain ne vaut pas la panne.
            isCrunchPngs = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.core:core-splashscreen:1.2.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.tv:tv-material:1.0.0")
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")
    implementation("androidx.media3:media3-exoplayer:1.10.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.10.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.10.1")
    implementation("androidx.media3:media3-ui:1.10.1")
    implementation("androidx.media3:media3-session:1.10.1")
    testImplementation("junit:junit:4.13.2")
    // Sur les tests JVM, org.json provient du stub d'android.jar dont chaque méthode lève « not mocked ».
    // La vraie implémentation, placée avant le stub sur le classpath de test, rend les analyseurs
    // de réponses testables hors appareil.
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

// Sur le partage réseau, Windows peut conserver brièvement le flux binaire d'un test après la fin
// du worker. Isoler ce flux par révision empêche un ancien verrou de bloquer la validation suivante.
tasks.withType<Test>().configureEach {
    val revisionTests = revisionPaquet.ifBlank { "local" }.replace(Regex("[^A-Za-z0-9._-]"), "_")
    binaryResultsDirectory.set(layout.buildDirectory.dir("test-results-binaires/$revisionTests/$name"))
}
