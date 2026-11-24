package cn.edu.haust.campusassistant;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SchoolCredentials")
public class SchoolCredentialsPlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "haust.school-credentials.v1";
    private static final String PREFS = "haust_school_credentials";
    private static final String CIPHERTEXT = "ciphertext";
    private static final String IV = "iv";
    private static final String CX_KEY_ALIAS = "haust.chaoxing-credentials.v1";
    private static final String CX_PREFS = "haust_chaoxing_credentials";

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private KeyStore keyStore() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        return store;
    }

    @PluginMethod
    public synchronized void read(PluginCall call) {
        readFrom(call, KEY_ALIAS, PREFS);
    }

    private void readFrom(PluginCall call, String alias, String prefsName) {
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(prefsName, Context.MODE_PRIVATE);
            String ciphertext = prefs.getString(CIPHERTEXT, null);
            if (ciphertext == null) {
                call.resolve(new JSObject());
                return;
            }
            SecretKey key = (SecretKey) keyStore().getKey(alias, null);
            if (key == null) throw new GeneralSecurityException("Credential key unavailable");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            byte[] iv = Base64.decode(prefs.getString(IV, ""), Base64.NO_WRAP);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] data = cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP));
            JSONObject payload = new JSONObject(new String(data, StandardCharsets.UTF_8));
            JSObject result = new JSObject();
            result.put("username", payload.getString("username"));
            result.put("password", payload.getString("password"));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not read saved school credentials");
        }
    }

    @PluginMethod
    public synchronized void write(PluginCall call) {
        writeTo(call, KEY_ALIAS, PREFS);
    }

    private void writeTo(PluginCall call, String alias, String prefsName) {
        String username = call.getString("username", "");
        String password = call.getString("password", "");
        if (username.isEmpty() || password.isEmpty()) {
            call.reject("School credentials are required");
            return;
        }
        try {
            SecretKey key = (SecretKey) keyStore().getKey(alias, null);
            if (key == null) {
                KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
                generator.init(new KeyGenParameterSpec.Builder(alias,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build());
                key = generator.generateKey();
            }
            JSONObject payload = new JSONObject().put("username", username).put("password", password);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] data = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));
            boolean saved = getContext().getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit()
                    .putString(CIPHERTEXT, Base64.encodeToString(data, Base64.NO_WRAP))
                    .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .commit();
            if (!saved) throw new GeneralSecurityException("Credential write failed");
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save school credentials");
        }
    }

    @PluginMethod
    public synchronized void clear(PluginCall call) {
        clearFrom(call, KEY_ALIAS, PREFS);
    }

    @PluginMethod
    public synchronized void purgeRetiredCredentials(PluginCall call) {
        clearFrom(call, CX_KEY_ALIAS, CX_PREFS);
    }

    private void clearFrom(PluginCall call, String alias, String prefsName) {
        try {
            if (!getContext().getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit().clear().commit()) {
                throw new GeneralSecurityException("Credential removal failed");
            }
            keyStore().deleteEntry(alias);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not clear saved school credentials");
        }
    }
}
