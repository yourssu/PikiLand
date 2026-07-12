package com.yourssu.pikiland.domain.model;

import java.util.List;

public class AiAnalysisResult {
    private final boolean confident;
    private final String summary;
    private final String impact;
    private final String causeDescription;
    private final boolean prNeeded;
    private final String patchSummary;
    private final List<PatchInstruction> patchInstructions;
    private final String prTitle;
    private final String prBody;

    public AiAnalysisResult(boolean confident, String summary, String impact, String causeDescription,
                            boolean prNeeded, String patchSummary, List<PatchInstruction> patchInstructions,
                            String prTitle, String prBody) {
        this.confident = confident;
        this.summary = summary;
        this.impact = impact;
        this.causeDescription = causeDescription;
        this.prNeeded = prNeeded;
        this.patchSummary = patchSummary;
        this.patchInstructions = patchInstructions;
        this.prTitle = prTitle;
        this.prBody = prBody;
    }

    public boolean isConfident() {
        return confident;
    }

    public String getSummary() {
        return summary;
    }

    public String getImpact() {
        return impact;
    }

    public String getCauseDescription() {
        return causeDescription;
    }

    public boolean isPrNeeded() {
        return prNeeded;
    }

    public String getPatchSummary() {
        return patchSummary;
    }

    public List<PatchInstruction> getPatchInstructions() {
        return patchInstructions;
    }

    public String getPrTitle() {
        return prTitle;
    }

    public String getPrBody() {
        return prBody;
    }
}
