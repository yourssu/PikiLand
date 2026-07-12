package com.yourssu.pikiland;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class PikilandApplication {
    public static void main(String[] args) {
        SpringApplication.run(PikilandApplication.class, args);
    }
}
