# -------- toolchain ---------------------------------------
CC := gcc
LD := ld

# -------- project layout ----------------------------------
SRC_DIR    := src
BUILD_DIR  := build
EXECUTABLE := $(BUILD_DIR)/runtime
SRC_FILES  := $(shell find $(SRC_DIR) -type f -name "*.c")
OBJ_FILES  := $(patsubst $(SRC_DIR)/%.c,$(BUILD_DIR)/%.o,$(SRC_FILES))

# -------- compiler / linker flags -------------------------
CFLAGS  := -Isrc -Wall -Wextra -O2 -fmodulo-sched
LDFLAGS := -s -pthread

# -------- pretty colors -----------------------------------
RESET   := \033[0m
BOLD    := \033[1m
RED     := \033[31m
GREEN   := \033[32m
YELLOW  := \033[33m
BLUE    := \033[34m
MAGENTA := \033[35m
CYAN    := \033[36m

# ==========================================================
.PHONY: all clean run format
all: $(EXECUTABLE)

# -------- build rules -------------------------------------
$(EXECUTABLE): $(OBJ_FILES) | $(BUILD_DIR)
	@echo -e "$(BOLD)$(GREEN)[ LD     ]$(RESET) $(MAGENTA)$@$(RESET)"
	@$(CC) $(OBJ_FILES) -o $@ $(LDFLAGS)

$(BUILD_DIR)/%.o: $(SRC_DIR)/%.c
	@mkdir -p $(dir $@)
	@echo -e "$(BOLD)$(BLUE)[ CC     ]$(RESET) $(CYAN)$<$(RESET)"
	@$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR):
	@mkdir -p $@

# -------- utility targets ---------------------------------
clean:
	@echo -e "$(BOLD)$(RED)[ CLEAN  ]$(RESET) $(YELLOW)purging: $(MAGENTA)$(BUILD_DIR)$(RESET)"
	@rm -rf $(BUILD_DIR)

format:
	@echo -e "$(BOLD)$(YELLOW)[ FORMAT ]$(RESET) $(CYAN)Running clang-format...$(RESET)"
	@find $(SRC_DIR) -type f \( -name '*.c' -o -name '*.h' \) -exec clang-format -i {} +
