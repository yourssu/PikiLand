package com.yourssu.pikiland.domain.port;

import com.yourssu.pikiland.domain.model.SystemSettings;
import java.util.Optional;

public interface SystemSettingsRepository {
    Optional<SystemSettings> findGlobalSettings();
    void saveGlobalSettings(SystemSettings settings);
}
