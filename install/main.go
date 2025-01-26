package main

import (
	"bufio"
	"embed"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"text/template"
	"unicode"

	"golang.org/x/term"
)

// DO NOT EDIT THIS FUNCTION; IT MATCHED BY REGEX IN CICD
func loadVersions(config *Config) {
	config.PangolinVersion = "replaceme"
	config.GerbilVersion = "replaceme"
}

//go:embed fs/*
var configFiles embed.FS

type Config struct {
	PangolinVersion            string
	GerbilVersion              string
	BaseDomain                 string
	DashboardDomain            string
	LetsEncryptEmail           string
	AdminUserEmail             string
	AdminUserPassword          string
	DisableSignupWithoutInvite bool
	DisableUserCreateOrg       bool
	EnableEmail                bool
	EmailSMTPHost              string
	EmailSMTPPort              int
	EmailSMTPUser              string
	EmailSMTPPass              string
	EmailNoReply               string
	InstallGerbil              bool
}

func main() {
	reader := bufio.NewReader(os.Stdin)

	// check if the user is root
	if os.Geteuid() != 0 {
		fmt.Println("This script must be run as root")
		os.Exit(1)
	}

	// check if there is already a config file
	if _, err := os.Stat("config/config.yml"); err != nil {
		config := collectUserInput(reader)

		loadVersions(&config)

		if err := createConfigFiles(config); err != nil {
			fmt.Printf("Error creating config files: %v\n", err)
			os.Exit(1)
		}

		if !isDockerInstalled() && runtime.GOOS == "linux" {
			if readBool(reader, "Docker is not installed. Would you like to install it?", true) {
				installDocker()
			}
		}
	} else {
		fmt.Println("Config file already exists... skipping configuration")
	}

	if isDockerInstalled() {
		if readBool(reader, "Would you like to install and start the containers?", true) {
			pullAndStartContainers()
		}
	}

	fmt.Println("Installation complete!")
}

func readString(reader *bufio.Reader, prompt string, defaultValue string) string {
	if defaultValue != "" {
		fmt.Printf("%s (default: %s): ", prompt, defaultValue)
	} else {
		fmt.Print(prompt + ": ")
	}
	input, _ := reader.ReadString('\n')
	input = strings.TrimSpace(input)
	if input == "" {
		return defaultValue
	}
	return input
}

func readPassword(prompt string) string {
	fmt.Print(prompt + ": ")

	// Read password without echo
	password, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Println() // Add a newline since ReadPassword doesn't add one

	if err != nil {
		return ""
	}

	input := strings.TrimSpace(string(password))
	if input == "" {
		return readPassword(prompt)
	}
	return input
}

func readBool(reader *bufio.Reader, prompt string, defaultValue bool) bool {
	defaultStr := "no"
	if defaultValue {
		defaultStr = "yes"
	}
	input := readString(reader, prompt+" (yes/no)", defaultStr)
	return strings.ToLower(input) == "yes"
}

func readInt(reader *bufio.Reader, prompt string, defaultValue int) int {
	input := readString(reader, prompt, fmt.Sprintf("%d", defaultValue))
	if input == "" {
		return defaultValue
	}
	value := defaultValue
	fmt.Sscanf(input, "%d", &value)
	return value
}

func collectUserInput(reader *bufio.Reader) Config {
	config := Config{}

	// Basic configuration
	fmt.Println("\n=== Basic Configuration ===")
	config.BaseDomain = readString(reader, "Enter your base domain (no subdomain e.g. example.com)", "")
	config.DashboardDomain = readString(reader, "Enter the domain for the Pangolin dashboard", "pangolin."+config.BaseDomain)
	config.LetsEncryptEmail = readString(reader, "Enter email for Let's Encrypt certificates", "")
	config.InstallGerbil = readBool(reader, "Do you want to use Gerbil to allow tunned connections", true)

	// Admin user configuration
	fmt.Println("\n=== Admin User Configuration ===")
	config.AdminUserEmail = readString(reader, "Enter admin user email", "admin@"+config.BaseDomain)
	for {
		pass1 := readPassword("Create admin user password")
		pass2 := readPassword("Confirm admin user password")

		if pass1 != pass2 {
			fmt.Println("Passwords do not match")
		} else {
			config.AdminUserPassword = pass1
			if valid, message := validatePassword(config.AdminUserPassword); valid {
				break
			} else {
				fmt.Println("Invalid password:", message)
				fmt.Println("Password requirements:")
				fmt.Println("- At least one uppercase English letter")
				fmt.Println("- At least one lowercase English letter")
				fmt.Println("- At least one digit")
				fmt.Println("- At least one special character")
			}
		}
	}

	// Security settings
	fmt.Println("\n=== Security Settings ===")
	config.DisableSignupWithoutInvite = readBool(reader, "Disable signup without invite", true)
	config.DisableUserCreateOrg = readBool(reader, "Disable users from creating organizations", false)

	// Email configuration
	fmt.Println("\n=== Email Configuration ===")
	config.EnableEmail = readBool(reader, "Enable email functionality", false)

	if config.EnableEmail {
		config.EmailSMTPHost = readString(reader, "Enter SMTP host", "")
		config.EmailSMTPPort = readInt(reader, "Enter SMTP port (default 587)", 587)
		config.EmailSMTPUser = readString(reader, "Enter SMTP username", "")
		config.EmailSMTPPass = readString(reader, "Enter SMTP password", "")
		config.EmailNoReply = readString(reader, "Enter no-reply email address", "")
	}

	// Validate required fields
	if config.BaseDomain == "" {
		fmt.Println("Error: Domain name is required")
		os.Exit(1)
	}
	if config.DashboardDomain == "" {
		fmt.Println("Error: Dashboard Domain name is required")
		os.Exit(1)
	}
	if config.LetsEncryptEmail == "" {
		fmt.Println("Error: Let's Encrypt email is required")
		os.Exit(1)
	}
	if config.AdminUserEmail == "" || config.AdminUserPassword == "" {
		fmt.Println("Error: Admin user email and password are required")
		os.Exit(1)
	}

	return config
}

func validatePassword(password string) (bool, string) {
	if len(password) == 0 {
		return false, "Password cannot be empty"
	}

	var (
		hasUpper   bool
		hasLower   bool
		hasDigit   bool
		hasSpecial bool
	)

	for _, char := range password {
		switch {
		case unicode.IsUpper(char):
			hasUpper = true
		case unicode.IsLower(char):
			hasLower = true
		case unicode.IsDigit(char):
			hasDigit = true
		case unicode.IsPunct(char) || unicode.IsSymbol(char):
			hasSpecial = true
		}
	}

	var missing []string
	if !hasUpper {
		missing = append(missing, "an uppercase letter")
	}
	if !hasLower {
		missing = append(missing, "a lowercase letter")
	}
	if !hasDigit {
		missing = append(missing, "a digit")
	}
	if !hasSpecial {
		missing = append(missing, "a special character")
	}

	if len(missing) > 0 {
		return false, fmt.Sprintf("Password must contain %s", strings.Join(missing, ", "))
	}

	return true, ""
}

func createConfigFiles(config Config) error {
	os.MkdirAll("config", 0755)
	os.MkdirAll("config/letsencrypt", 0755)
	os.MkdirAll("config/db", 0755)
	os.MkdirAll("config/logs", 0755)

	// Walk through all embedded files
	err := fs.WalkDir(configFiles, "fs", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip the root fs directory itself
		if path == "fs" {
			return nil
		}

		// Get the relative path by removing the "fs/" prefix
		relPath := strings.TrimPrefix(path, "fs/")

        // skip .DS_Store
        if strings.Contains(relPath, ".DS_Store") {
            return nil
        }

		// Create the full output path under "config/"
		outPath := filepath.Join("config", relPath)

		if d.IsDir() {
			// Create directory
			if err := os.MkdirAll(outPath, 0755); err != nil {
				return fmt.Errorf("failed to create directory %s: %v", outPath, err)
			}
			return nil
		}

		// Read the template file
		content, err := configFiles.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read %s: %v", path, err)
		}

		// Parse template
		tmpl, err := template.New(d.Name()).Parse(string(content))
		if err != nil {
			return fmt.Errorf("failed to parse template %s: %v", path, err)
		}

		// Ensure parent directory exists
		if err := os.MkdirAll(filepath.Dir(outPath), 0755); err != nil {
			return fmt.Errorf("failed to create parent directory for %s: %v", outPath, err)
		}

		// Create output file
		outFile, err := os.Create(outPath)
		if err != nil {
			return fmt.Errorf("failed to create %s: %v", outPath, err)
		}
		defer outFile.Close()

		// Execute template
		if err := tmpl.Execute(outFile, config); err != nil {
			return fmt.Errorf("failed to execute template %s: %v", path, err)
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("error walking config files: %v", err)
	}

	// get the current directory
	dir, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("failed to get current directory: %v", err)
	}

	sourcePath := filepath.Join(dir, "config/docker-compose.yml")
	destPath := filepath.Join(dir, "docker-compose.yml")

	// Check if source file exists
	if _, err := os.Stat(sourcePath); err != nil {
		return fmt.Errorf("source docker-compose.yml not found: %v", err)
	}

	// Try to move the file
	err = os.Rename(sourcePath, destPath)
	if err != nil {
		return fmt.Errorf("failed to move docker-compose.yml from %s to %s: %v",
			sourcePath, destPath, err)
	}

	return nil
}

func installDocker() error {
	// Detect Linux distribution
	cmd := exec.Command("cat", "/etc/os-release")
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("failed to detect Linux distribution: %v", err)
	}
	osRelease := string(output)

	// Detect system architecture
	archCmd := exec.Command("uname", "-m")
	archOutput, err := archCmd.Output()
	if err != nil {
		return fmt.Errorf("failed to detect system architecture: %v", err)
	}
	arch := strings.TrimSpace(string(archOutput))

	// Map architecture to Docker's architecture naming
	var dockerArch string
	switch arch {
	case "x86_64":
		dockerArch = "amd64"
	case "aarch64":
		dockerArch = "arm64"
	default:
		return fmt.Errorf("unsupported architecture: %s", arch)
	}

	var installCmd *exec.Cmd
	switch {
	case strings.Contains(osRelease, "ID=ubuntu"):
		installCmd = exec.Command("bash", "-c", fmt.Sprintf(`
			apt-get update &&
			apt-get install -y apt-transport-https ca-certificates curl software-properties-common &&
			curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg &&
			echo "deb [arch=%s signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list &&
			apt-get update &&
			apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
		`, dockerArch))
	case strings.Contains(osRelease, "ID=debian"):
		installCmd = exec.Command("bash", "-c", fmt.Sprintf(`
			apt-get update &&
			apt-get install -y apt-transport-https ca-certificates curl software-properties-common &&
			curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg &&
			echo "deb [arch=%s signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list &&
			apt-get update &&
			apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
		`, dockerArch))
	case strings.Contains(osRelease, "ID=fedora"):
		installCmd = exec.Command("bash", "-c", fmt.Sprintf(`
			dnf -y install dnf-plugins-core &&
			dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo &&
			dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
		`))
	case strings.Contains(osRelease, "ID=opensuse") || strings.Contains(osRelease, "ID=\"opensuse-"):
		installCmd = exec.Command("bash", "-c", `
			zypper install -y docker docker-compose &&
			systemctl enable docker
		`)
	case strings.Contains(osRelease, "ID=rhel") || strings.Contains(osRelease, "ID=\"rhel"):
		installCmd = exec.Command("bash", "-c", fmt.Sprintf(`
			dnf remove -y runc &&
			dnf -y install yum-utils &&
			dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo &&
			dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin &&
			systemctl enable docker
		`))
	case strings.Contains(osRelease, "ID=amzn"):
		installCmd = exec.Command("bash", "-c", `
			yum update -y &&
			yum install -y docker &&
			systemctl enable docker &&
			usermod -a -G docker ec2-user
		`)
	default:
		return fmt.Errorf("unsupported Linux distribution")
	}
	installCmd.Stdout = os.Stdout
	installCmd.Stderr = os.Stderr
	return installCmd.Run()
}

func isDockerInstalled() bool {
	cmd := exec.Command("docker", "--version")
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

func getCommandString(useNewStyle bool) string {
	if useNewStyle {
		return "'docker compose'"
	}
	return "'docker-compose'"
}

func pullAndStartContainers() error {
	fmt.Println("Starting containers...")

	// Check which docker compose command is available
	var useNewStyle bool
	checkCmd := exec.Command("docker", "compose", "version")
	if err := checkCmd.Run(); err == nil {
		useNewStyle = true
	} else {
		// Check if docker-compose (old style) is available
		checkCmd = exec.Command("docker-compose", "version")
		if err := checkCmd.Run(); err != nil {
			return fmt.Errorf("neither 'docker compose' nor 'docker-compose' command is available: %v", err)
		}
	}

	// Helper function to execute docker compose commands
	executeCommand := func(args ...string) error {
		var cmd *exec.Cmd
		if useNewStyle {
			cmd = exec.Command("docker", append([]string{"compose"}, args...)...)
		} else {
			cmd = exec.Command("docker-compose", args...)
		}
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}

	// Pull containers
	fmt.Printf("Using %s command to pull containers...\n", getCommandString(useNewStyle))
	if err := executeCommand("-f", "docker-compose.yml", "pull"); err != nil {
		return fmt.Errorf("failed to pull containers: %v", err)
	}

	// Start containers
	fmt.Printf("Using %s command to start containers...\n", getCommandString(useNewStyle))
	if err := executeCommand("-f", "docker-compose.yml", "up", "-d"); err != nil {
		return fmt.Errorf("failed to start containers: %v", err)
	}

	return nil
}