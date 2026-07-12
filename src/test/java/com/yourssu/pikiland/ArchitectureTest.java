package com.yourssu.pikiland;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;

import static com.tngtech.archunit.library.Architectures.layeredArchitecture;

public class ArchitectureTest {

    @Test
    public void testLayeredArchitecture() {
        ArchRule rule = layeredArchitecture()
                .consideringAllDependencies()
                .layer("Presentation").definedBy("com.yourssu.pikiland.presentation..")
                .layer("Application").definedBy("com.yourssu.pikiland.application..")
                .layer("Domain").definedBy("com.yourssu.pikiland.domain..")
                .layer("Infrastructure").definedBy("com.yourssu.pikiland.infrastructure..")

                .whereLayer("Presentation").mayNotBeAccessedByAnyLayer()
                .whereLayer("Application").mayOnlyBeAccessedByLayers("Presentation")
                .whereLayer("Domain").mayOnlyBeAccessedByLayers("Application", "Infrastructure")
                .whereLayer("Infrastructure").mayNotBeAccessedByAnyLayer();

        rule.check(new ClassFileImporter()
                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.yourssu.pikiland"));
    }
}
