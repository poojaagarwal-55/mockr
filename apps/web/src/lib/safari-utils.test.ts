/**
 * Unit tests for Safari-specific utilities.
 * 
 * **Validates: Requirements 5.1, 5.3, 5.4, 5.5**
 */

import {
    isSafariBrowser,
    normalizeBooleanAttributes,
    normalizeAttributes,
    suppressHydrationWarning,
    isClient,
    isServer,
} from "./safari-utils";

describe("isSafariBrowser", () => {
    const originalNavigator = global.navigator;

    afterEach(() => {
        Object.defineProperty(global, "navigator", {
            value: originalNavigator,
            writable: true,
        });
    });

    it("should detect Safari browser", () => {
        Object.defineProperty(global, "navigator", {
            value: {
                userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
            },
            writable: true,
        });

        expect(isSafariBrowser()).toBe(true);
    });

    it("should detect iOS Safari", () => {
        Object.defineProperty(global, "navigator", {
            value: {
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            },
            writable: true,
        });

        expect(isSafariBrowser()).toBe(true);
    });

    it("should not detect Chrome as Safari", () => {
        Object.defineProperty(global, "navigator", {
            value: {
                userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            writable: true,
        });

        expect(isSafariBrowser()).toBe(false);
    });

    it("should return false in server environment", () => {
        const originalWindow = global.window;
        // @ts-ignore
        delete global.window;

        expect(isSafariBrowser()).toBe(false);

        global.window = originalWindow;
    });
});

describe("normalizeBooleanAttributes", () => {
    it("should normalize empty boolean attributes", () => {
        const element = document.createElement("input");
        element.setAttribute("disabled", "");

        normalizeBooleanAttributes(element);

        expect(element.getAttribute("disabled")).toBe("disabled");
    });

    it("should normalize 'true' boolean attributes", () => {
        const element = document.createElement("input");
        element.setAttribute("checked", "true");

        normalizeBooleanAttributes(element);

        expect(element.getAttribute("checked")).toBe("checked");
    });

    it("should handle multiple boolean attributes", () => {
        const element = document.createElement("input");
        element.setAttribute("disabled", "");
        element.setAttribute("required", "true");
        element.setAttribute("readonly", "");

        normalizeBooleanAttributes(element);

        expect(element.getAttribute("disabled")).toBe("disabled");
        expect(element.getAttribute("required")).toBe("required");
        expect(element.getAttribute("readonly")).toBe("readonly");
    });

    it("should not modify non-boolean attributes", () => {
        const element = document.createElement("input");
        element.setAttribute("type", "text");
        element.setAttribute("value", "test");

        normalizeBooleanAttributes(element);

        expect(element.getAttribute("type")).toBe("text");
        expect(element.getAttribute("value")).toBe("test");
    });
});

describe("normalizeAttributes", () => {
    it("should normalize style attribute with extra spaces", () => {
        const element = document.createElement("div");
        element.setAttribute("style", "color:  red;  margin:  10px;");

        normalizeAttributes(element);

        expect(element.getAttribute("style")).toBe("color: red; margin: 10px;");
    });

    it("should normalize class attribute with extra spaces", () => {
        const element = document.createElement("div");
        element.setAttribute("class", "class1  class2   class3");

        normalizeAttributes(element);

        expect(element.getAttribute("class")).toBe("class1 class2 class3");
    });

    it("should normalize boolean attributes", () => {
        const element = document.createElement("input");
        element.setAttribute("disabled", "");
        element.setAttribute("class", "input  field");

        normalizeAttributes(element);

        expect(element.getAttribute("disabled")).toBe("disabled");
        expect(element.getAttribute("class")).toBe("input field");
    });

    it("should handle elements without attributes", () => {
        const element = document.createElement("div");

        expect(() => normalizeAttributes(element)).not.toThrow();
    });
});

describe("suppressHydrationWarning", () => {
    it("should return suppressHydrationWarning prop", () => {
        const result = suppressHydrationWarning();

        expect(result).toEqual({ suppressHydrationWarning: true });
    });

    it("should be spreadable as props", () => {
        const props = {
            className: "test",
            ...suppressHydrationWarning(),
        };

        expect(props).toEqual({
            className: "test",
            suppressHydrationWarning: true,
        });
    });
});

describe("isClient and isServer", () => {
    it("should detect client environment", () => {
        expect(isClient()).toBe(true);
        expect(isServer()).toBe(false);
    });

    it("should detect server environment", () => {
        const originalWindow = global.window;
        // @ts-ignore
        delete global.window;

        expect(isClient()).toBe(false);
        expect(isServer()).toBe(true);

        global.window = originalWindow;
    });

    it("should be inverse of each other", () => {
        expect(isClient()).toBe(!isServer());
    });
});
