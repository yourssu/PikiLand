package com.yourssu.pikiland;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

import org.springframework.boot.WebApplicationType;
import java.util.Arrays;

@SpringBootApplication
@EnableAsync
public class PikilandApplication {
    public static void main(String[] args) {
        boolean isCli = Arrays.asList(args).contains("--cli") || System.getenv("PIKILAND_CLI") != null;
        SpringApplication app = new SpringApplication(PikilandApplication.class);
        if (isCli) {
            app.setWebApplicationType(WebApplicationType.NONE);
        }
        app.run(args);
    }
}
