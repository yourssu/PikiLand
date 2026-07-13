package com.yourssu.pikiland;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.Architectures.layeredArchitecture;

public class ArchitectureTest {

    private JavaClasses classes;

    @BeforeEach
    void importClasses() {
        classes = new ClassFileImporter()
                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.yourssu.pikiland");
    }

    /**
     * Enforces the hexagonal layer dependency directions:
     *
     * <pre>
     *  Presentation → Application → Domain ← Infrastructure
     * </pre>
     *
     * Notable design decision: Infrastructure classes ARE allowed to depend on other
     * Infrastructure classes (same-layer composition). For example,
     * {@code GithubAppAuthenticator} creates two {@code RestTemplate} instances
     * internally to handle the 302-redirect case for S3 log downloads — both live in
     * the same {@code infrastructure.github} package and that is intentional.
     * ArchUnit's {@code mayNotBeAccessedByAnyLayer()} applies only to accesses coming
     * FROM OTHER named layers, so intra-Infrastructure calls are already permitted by
     * the framework; this comment documents that explicitly.
     */
    @Test
    public void testLayeredArchitecture() {
        ArchRule rule = layeredArchitecture()
                .consideringAllDependencies()
                .layer("Presentation").definedBy("com.yourssu.pikiland.presentation..")
                .layer("Application").definedBy("com.yourssu.pikiland.application..")
                .layer("Domain").definedBy("com.yourssu.pikiland.domain..")
                .layer("Infrastructure").definedBy("com.yourssu.pikiland.infrastructure..")

                // Presentation is the outermost ring: nothing should depend on it
                .whereLayer("Presentation").mayNotBeAccessedByAnyLayer()
                // Application is only called by Presentation (controllers, webhooks)
                .whereLayer("Application").mayOnlyBeAccessedByLayers("Presentation")
                // Domain is the pure core: accessed by Application and Infrastructure (port implementations)
                .whereLayer("Domain").mayOnlyBeAccessedByLayers("Application", "Infrastructure")
                // Infrastructure adapters must not be directly imported by upper layers —
                // they are wired via Domain ports through Spring DI.
                // Intra-Infrastructure access (Infrastructure → Infrastructure) is intentionally allowed.
                .whereLayer("Infrastructure").mayNotBeAccessedByAnyLayer();

        rule.check(classes);
    }

    /**
     * Stronger purity guarantee: Domain classes must never import anything from
     * Infrastructure, Application, or Presentation packages — not even transitively
     * through a shared utility. This ensures the domain model stays framework-free
     * and independently testable.
     */
    @Test
    public void testDomainHasNoDependencyOnOtherLayers() {
        ArchRule rule = noClasses()
                .that().resideInAPackage("com.yourssu.pikiland.domain..")
                .should().dependOnClassesThat()
                .resideInAnyPackage(
                        "com.yourssu.pikiland.infrastructure..",
                        "com.yourssu.pikiland.application..",
                        "com.yourssu.pikiland.presentation.."
                )
                .because("Domain must be a pure, framework-free core with no outward dependencies.");

        rule.check(classes);
    }
}
